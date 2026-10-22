#include <string.h>
#include "experience-timelines.h"

// Simulation-only firmware; it intentionally has no actuator library,
// pin configuration, or GPIO writes.
const uint8_t LINE_BUFFER_SIZE = 160;
const uint8_t MAX_FIELDS = 6;
const uint8_t MAX_REQUEST_ID_LENGTH = 16;
const uint8_t MAX_OPERATION_ID_LENGTH = 16;
const uint8_t REQUEST_CACHE_SIZE = 4;
const uint8_t OPERATION_HISTORY_SIZE = 4;
const uint8_t PROTOCOL_VERSION = 2;
const unsigned long BAUD_RATE = 9600;

char inputLine[LINE_BUFFER_SIZE];
uint8_t inputLength = 0;
bool lineTooLong = false;

struct JsonField {
  char key[16];
  char value[24];
  bool isString;
};

struct CachedAcknowledgement {
  char requestId[MAX_REQUEST_ID_LENGTH + 1];
  char command[16];
  char operationId[MAX_OPERATION_ID_LENGTH + 1];
  char code[24];
  uint32_t signature;
  uint8_t state;
  bool accepted;
  bool hasOperationId;
  bool occupied;
};

enum ControlState {
  STATE_IDLE,
  STATE_RUNNING,
  STATE_STOPPING,
  STATE_COMPLETED,
  STATE_FAULT
};

enum Experience {
  EXPERIENCE_NONE,
  EXPERIENCE_WIND,
  EXPERIENCE_WAVE,
  EXPERIENCE_BUBBLE
};

CachedAcknowledgement requestCache[REQUEST_CACHE_SIZE];
char operationHistory[OPERATION_HISTORY_SIZE][MAX_OPERATION_ID_LENGTH + 1];
uint8_t requestCacheIndex = 0;
uint8_t operationHistoryIndex = 0;
ControlState controlState = STATE_IDLE;
Experience selectedExperience = EXPERIENCE_NONE;
char activeOperationId[MAX_OPERATION_ID_LENGTH + 1];
uint32_t operationStartedAt = 0;
uint32_t actionDeadline = 0;
uint32_t elapsedBeforeCurrentAction = 0;
uint16_t actionIndex = 0;
uint16_t actionCount = 0;
bool runActive = false;

const __FlashStringHelper* stateName(ControlState state) {
  switch (state) {
    case STATE_IDLE: return F("IDLE");
    case STATE_RUNNING: return F("RUNNING");
    case STATE_STOPPING: return F("STOPPING");
    case STATE_COMPLETED: return F("COMPLETED");
    case STATE_FAULT: return F("FAULT");
  }
  return F("FAULT");
}

const __FlashStringHelper* experienceName(Experience experience) {
  switch (experience) {
    case EXPERIENCE_WIND: return F("WIND");
    case EXPERIENCE_WAVE: return F("WAVE");
    case EXPERIENCE_BUBBLE: return F("BUBBLE");
    default: return F("null");
  }
}

const ScheduledAction* currentTimeline() {
  switch (selectedExperience) {
    case EXPERIENCE_WIND: return WIND_ACTIONS;
    case EXPERIENCE_WAVE: return WAVE_ACTIONS;
    case EXPERIENCE_BUBBLE: return BUBBLE_ACTIONS;
    default: return NULL;
  }
}

uint16_t currentDuration() {
  switch (selectedExperience) {
    case EXPERIENCE_WIND: return 24000;
    case EXPERIENCE_WAVE: return 25000;
    case EXPERIENCE_BUBBLE: return 27420;
    default: return 0;
  }
}

uint16_t currentActionCount() {
  switch (selectedExperience) {
    case EXPERIENCE_WIND: return WIND_ACTION_COUNT;
    case EXPERIENCE_WAVE: return WAVE_ACTION_COUNT;
    case EXPERIENCE_BUBBLE: return BUBBLE_ACTION_COUNT;
    default: return 0;
  }
}

bool validIdentifier(const char* value, uint8_t maximumLength) {
  const uint8_t length = strlen(value);
  if (length == 0 || length > maximumLength) return false;
  for (uint8_t index = 0; index < length; index++) {
    const char character = value[index];
    if (!((character >= 'a' && character <= 'z') ||
          (character >= 'A' && character <= 'Z') ||
          (character >= '0' && character <= '9') ||
          character == '-' || character == '_')) {
      return false;
    }
  }
  return true;
}

void printEscaped(const char* value) {
  for (const char* cursor = value; *cursor; cursor++) {
    if (*cursor == '"' || *cursor == '\\') Serial.write('\\');
    Serial.write(*cursor);
  }
}

void printError(const char* code) {
  Serial.print(F("{\"type\":\"ERROR\",\"code\":\""));
  printEscaped(code);
  Serial.println(F("\"}"));
}

void printAcknowledgement(
  const char* type,
  const char* command,
  const char* requestId,
  bool accepted,
  ControlState state,
  const char* code,
  const char* operationId,
  bool includeIdentity
) {
  Serial.print(F("{\"type\":\""));
  Serial.print(type);
  Serial.print(F("\",\"command\":\""));
  Serial.print(command);
  Serial.print(F("\",\"accepted\":"));
  Serial.print(accepted ? F("true") : F("false"));
  Serial.print(F(",\"requestId\":\""));
  printEscaped(requestId);
  Serial.print(F("\",\"state\":\""));
  Serial.print(stateName(state));
  Serial.print(F("\""));
  if (operationId && operationId[0]) {
    Serial.print(F(",\"operationId\":\""));
    printEscaped(operationId);
    Serial.print(F("\""));
  }
  if (code && code[0]) {
    Serial.print(F(",\"code\":\""));
    printEscaped(code);
    Serial.print(F("\""));
  }
  if (includeIdentity) {
    Serial.print(F(",\"protocol\":"));
    Serial.print(PROTOCOL_VERSION);
    Serial.print(F(",\"firmware\":\"nature-touch-unified-simulation\""));
    Serial.print(F(",\"deviceId\":\"nature-touch-nano-simulation\""));
    Serial.print(F(",\"hardwareOutputsEnabled\":false"));
    Serial.print(F(",\"capabilities\":[\"WIND\",\"WAVE\",\"BUBBLE\",\"SIMULATION_ONLY\"]"));
  }
  Serial.println(F("}"));
}

bool skipWhitespace(const char*& cursor) {
  while (*cursor == ' ' || *cursor == '\t' || *cursor == '\r') cursor++;
  return *cursor != '\0';
}

bool readJsonString(const char*& cursor, char* output, uint8_t capacity) {
  if (*cursor != '"') return false;
  cursor++;
  uint8_t length = 0;
  while (*cursor && *cursor != '"') {
    const char character = *cursor++;
    if (character == '\\' || static_cast<uint8_t>(character) < 0x20) return false;
    if (length >= capacity - 1) return false;
    output[length++] = character;
  }
  if (*cursor != '"') return false;
  cursor++;
  output[length] = '\0';
  return true;
}

bool parseJsonObject(const char* line, JsonField* fields, uint8_t& fieldCount) {
  const char* cursor = line;
  fieldCount = 0;
  if (!skipWhitespace(cursor) || *cursor++ != '{') return false;

  while (true) {
    if (!skipWhitespace(cursor)) return false;
    if (*cursor == '}') {
      cursor++;
      skipWhitespace(cursor);
      return *cursor == '\0';
    }
    if (fieldCount >= MAX_FIELDS) return false;

    JsonField& field = fields[fieldCount];
    if (!readJsonString(cursor, field.key, sizeof(field.key))) return false;
    for (uint8_t index = 0; index < fieldCount; index++) {
      if (strcmp(fields[index].key, field.key) == 0) return false;
    }
    if (!skipWhitespace(cursor) || *cursor++ != ':') return false;
    if (!skipWhitespace(cursor)) return false;

    if (*cursor == '"') {
      field.isString = true;
      if (!readJsonString(cursor, field.value, sizeof(field.value))) return false;
    } else {
      field.isString = false;
      uint8_t length = 0;
      while (*cursor >= '0' && *cursor <= '9') {
        if (length >= sizeof(field.value) - 1) return false;
        field.value[length++] = *cursor++;
      }
      if (length == 0) return false;
      field.value[length] = '\0';
    }
    fieldCount++;
    if (!skipWhitespace(cursor)) return false;
    if (*cursor == '}') continue;
    if (*cursor++ != ',') return false;
  }
}

const JsonField* findField(const JsonField* fields, uint8_t fieldCount, const char* key) {
  for (uint8_t index = 0; index < fieldCount; index++) {
    if (strcmp(fields[index].key, key) == 0) return &fields[index];
  }
  return NULL;
}

uint32_t signatureFor(const char* command, const char* payload) {
  uint32_t hash = 2166136261UL;
  while (*command) {
    hash ^= static_cast<uint8_t>(*command++);
    hash *= 16777619UL;
  }
  hash ^= ':';
  hash *= 16777619UL;
  while (*payload) {
    hash ^= static_cast<uint8_t>(*payload++);
    hash *= 16777619UL;
  }
  return hash;
}

int8_t findCachedRequest(const char* requestId) {
  for (uint8_t index = 0; index < REQUEST_CACHE_SIZE; index++) {
    if (requestCache[index].occupied &&
        strcmp(requestCache[index].requestId, requestId) == 0) {
      return index;
    }
  }
  return -1;
}

void sendCachedAcknowledgement(const CachedAcknowledgement& cached) {
  printAcknowledgement(
    cached.accepted ? "ACK" : "NACK",
    cached.command,
    cached.requestId,
    cached.accepted,
    static_cast<ControlState>(cached.state),
    cached.code,
    cached.hasOperationId ? cached.operationId : NULL,
    strcmp(cached.command, "IDENTIFY") == 0 && cached.accepted
  );
}

void cacheAcknowledgement(
  const char* requestId,
  const char* command,
  uint32_t signature,
  bool accepted,
  const char* code,
  const char* operationId
) {
  CachedAcknowledgement& cached = requestCache[requestCacheIndex];
  requestCacheIndex = (requestCacheIndex + 1) % REQUEST_CACHE_SIZE;
  strncpy(cached.requestId, requestId, MAX_REQUEST_ID_LENGTH);
  cached.requestId[MAX_REQUEST_ID_LENGTH] = '\0';
  strncpy(cached.command, command, sizeof(cached.command) - 1);
  cached.command[sizeof(cached.command) - 1] = '\0';
  strncpy(cached.code, code ? code : "", sizeof(cached.code) - 1);
  cached.code[sizeof(cached.code) - 1] = '\0';
  strncpy(cached.operationId, operationId ? operationId : "", MAX_OPERATION_ID_LENGTH);
  cached.operationId[MAX_OPERATION_ID_LENGTH] = '\0';
  cached.signature = signature;
  cached.state = controlState;
  cached.accepted = accepted;
  cached.hasOperationId = operationId && operationId[0];
  cached.occupied = true;
}

void rememberOperation(const char* operationId) {
  strncpy(operationHistory[operationHistoryIndex], operationId, MAX_OPERATION_ID_LENGTH);
  operationHistory[operationHistoryIndex][MAX_OPERATION_ID_LENGTH] = '\0';
  operationHistoryIndex = (operationHistoryIndex + 1) % OPERATION_HISTORY_SIZE;
}

bool operationWasUsed(const char* operationId) {
  for (uint8_t index = 0; index < OPERATION_HISTORY_SIZE; index++) {
    if (operationHistory[index][0] &&
        strcmp(operationHistory[index], operationId) == 0) {
      return true;
    }
  }
  return false;
}

void sendEvent(const char* name, const char* operationId) {
  Serial.print(F("{\"type\":\"EVENT\",\"name\":\""));
  Serial.print(name);
  Serial.print(F("\",\"operationId\":\""));
  printEscaped(operationId);
  Serial.print(F("\""));
  if (strcmp(name, "COMPLETED") == 0) {
    Serial.print(F(",\"experienceId\":\""));
    Serial.print(experienceName(selectedExperience));
    Serial.print(F("\""));
  }
  Serial.println(F("}"));
}

uint32_t elapsedTime(uint32_t now) {
  if (controlState != STATE_RUNNING) {
    return controlState == STATE_COMPLETED ? currentDuration() : elapsedBeforeCurrentAction;
  }
  const uint32_t elapsed = now - operationStartedAt;
  const uint16_t duration = currentDuration();
  return elapsed > duration ? duration : elapsed;
}

void sendStatus(const char* requestId) {
  const uint32_t elapsed = elapsedTime(millis());
  const uint16_t duration = currentDuration();
  Serial.print(F("{\"type\":\"STATUS\",\"requestId\":\""));
  printEscaped(requestId);
  Serial.print(F("\",\"acknowledgement\":{\"type\":\"ACK\",\"command\":\"STATUS_QUERY\",\"accepted\":true,\"requestId\":\""));
  printEscaped(requestId);
  Serial.print(F("\",\"state\":\""));
  Serial.print(stateName(controlState));
  Serial.print(F("\"},\"snapshot\":{\"state\":\""));
  Serial.print(stateName(controlState));
  Serial.print(F("\",\"selectedExperienceId\":"));
  if (selectedExperience == EXPERIENCE_NONE) Serial.print(F("null"));
  else {
    Serial.print(F("\""));
    Serial.print(experienceName(selectedExperience));
    Serial.print(F("\""));
  }
  Serial.print(F(",\"operationId\":"));
  if (activeOperationId[0]) {
    Serial.print(F("\""));
    printEscaped(activeOperationId);
    Serial.print(F("\""));
  } else {
    Serial.print(F("null"));
  }
  Serial.print(F(",\"elapsedMs\":"));
  Serial.print(elapsed);
  Serial.print(F(",\"durationMs\":"));
  if (duration) Serial.print(duration);
  else Serial.print(F("null"));
  Serial.print(F(",\"faultCode\":null,\"hardwareOutputsEnabled\":false}}\r\n"));
}

void sendActionEvent(uint32_t atMs, uint16_t durationMs, bool inflate) {
  Serial.print(F("{\"type\":\"EVENT\",\"name\":\"ACTUATOR_EVENT\",\"operationId\":\""));
  printEscaped(activeOperationId);
  Serial.print(F("\",\"experienceId\":\""));
  Serial.print(experienceName(selectedExperience));
  Serial.print(F("\",\"atMs\":"));
  Serial.print(atMs);
  Serial.print(F(",\"action\":\""));
  Serial.print(inflate ? F("INFLATE") : F("DEFLATE"));
  Serial.print(F("\",\"durationMs\":"));
  Serial.print(durationMs);
  Serial.print(F(",\"D5\":"));
  Serial.print(inflate ? 180 : 0);
  Serial.print(F(",\"D6\":"));
  Serial.print(inflate ? 180 : 0);
  Serial.print(F(",\"D7\":"));
  Serial.print(inflate ? 0 : 180);
  Serial.println(F(",\"hardwareOutputsEnabled\":false}"));
}

void sendTimelineMarker(uint32_t atMs) {
  const char* marker = NULL;
  if (selectedExperience == EXPERIENCE_WIND && atMs == 0) marker = "INITIAL FILL";
  if (selectedExperience == EXPERIENCE_WAVE && atMs == 0) marker = "INITIAL FILL";
  if (selectedExperience == EXPERIENCE_BUBBLE && atMs == 4420) marker = "PLAY AUDIO NOW";
  if ((selectedExperience == EXPERIENCE_WIND || selectedExperience == EXPERIENCE_WAVE) &&
      atMs == 5000) {
    marker = selectedExperience == EXPERIENCE_WIND
      ? "PLAY WIND AUDIO NOW"
      : "PLAY WAVE AUDIO NOW";
  }
  if (selectedExperience == EXPERIENCE_BUBBLE && atMs == 5000) marker = "BUBBLE START";
  if (selectedExperience == EXPERIENCE_WIND && atMs == 19000) marker = "FINAL SHRINK";
  if (selectedExperience == EXPERIENCE_WAVE && atMs == 20000) marker = "FINAL SHRINK";
  if (selectedExperience == EXPERIENCE_BUBBLE && atMs == 24420) marker = "FINAL SHRINK";
  if (!marker) return;

  Serial.print(F("{\"type\":\"EVENT\",\"name\":\"MARKER\",\"operationId\":\""));
  printEscaped(activeOperationId);
  Serial.print(F("\",\"experienceId\":\""));
  Serial.print(experienceName(selectedExperience));
  Serial.print(F("\",\"atMs\":"));
  Serial.print(atMs);
  Serial.print(F(",\"text\":\""));
  Serial.print(marker);
  Serial.println(F("\"}"));
}

void beginScheduledAction() {
  const ScheduledAction* timeline = currentTimeline();
  if (!timeline || actionIndex >= actionCount) return;
  const ScheduledAction action = {
    pgm_read_word(&timeline[actionIndex].durationMs),
    pgm_read_byte(&timeline[actionIndex].inflate)
  };
  sendTimelineMarker(elapsedBeforeCurrentAction);
  sendActionEvent(elapsedBeforeCurrentAction, action.durationMs, action.inflate != 0);
  actionDeadline += action.durationMs;
}

void startOperation(const char* operationId, uint32_t now) {
  strncpy(activeOperationId, operationId, MAX_OPERATION_ID_LENGTH);
  activeOperationId[MAX_OPERATION_ID_LENGTH] = '\0';
  rememberOperation(operationId);
  operationStartedAt = now;
  actionDeadline = now;
  elapsedBeforeCurrentAction = 0;
  actionIndex = 0;
  actionCount = currentActionCount();
  runActive = true;
  controlState = STATE_RUNNING;
  actionDeadline = now;
}

void processScheduler(uint32_t now) {
  if (!runActive || static_cast<int32_t>(now - actionDeadline) < 0) return;

  const ScheduledAction* timeline = currentTimeline();
  const uint16_t previousDuration = pgm_read_word(&timeline[actionIndex].durationMs);
  elapsedBeforeCurrentAction += previousDuration;
  actionIndex++;

  if (actionIndex >= actionCount) {
    runActive = false;
    controlState = STATE_COMPLETED;
    Serial.print(F("{\"type\":\"EVENT\",\"name\":\"MARKER\",\"operationId\":\""));
    printEscaped(activeOperationId);
    Serial.print(F("\",\"experienceId\":\""));
    Serial.print(experienceName(selectedExperience));
    Serial.print(F("\",\"atMs\":"));
    Serial.print(currentDuration());
    Serial.print(F(",\"text\":\""));
    if (selectedExperience == EXPERIENCE_WIND) Serial.print(F("NEXT WIND CYCLE"));
    else if (selectedExperience == EXPERIENCE_WAVE) Serial.print(F("NEXT WAVE CYCLE"));
    else Serial.print(F("NEXT ROUND"));
    Serial.println(F("\"}"));
    sendEvent("COMPLETED", activeOperationId);
    return;
  }

  beginScheduledAction();
}

const char* validCommandName(const char* type) {
  static const char* const commands[] = {
    "IDENTIFY", "SELECT", "START", "STOP", "STATUS_QUERY", "RECOVER"
  };
  for (uint8_t index = 0; index < sizeof(commands) / sizeof(commands[0]); index++) {
    if (strcmp(commands[index], type) == 0) return commands[index];
  }
  return NULL;
}

void rejectCommand(const char* command, const char* requestId, const char* code) {
  printAcknowledgement("NACK", command, requestId, false, controlState, code, NULL, false);
}

void processProtocolCommand(const char* line) {
  JsonField fields[MAX_FIELDS];
  uint8_t fieldCount = 0;
  if (!parseJsonObject(line, fields, fieldCount)) {
    printError("INVALID_SCHEMA");
    return;
  }

  const JsonField* typeField = findField(fields, fieldCount, "type");
  const JsonField* requestField = findField(fields, fieldCount, "requestId");
  if (!typeField || !typeField->isString || !requestField || !requestField->isString) {
    printError("INVALID_SCHEMA");
    return;
  }

  const char* command = validCommandName(typeField->value);
  if (!command) {
    if (validIdentifier(requestField->value, MAX_REQUEST_ID_LENGTH)) {
      rejectCommand("UNKNOWN", requestField->value, "INVALID_COMMAND");
    } else {
      printError("INVALID_REQUEST_ID");
    }
    return;
  }
  if (!validIdentifier(requestField->value, MAX_REQUEST_ID_LENGTH)) {
    printError("INVALID_REQUEST_ID");
    return;
  }

  const JsonField* payloadField = NULL;
  const char* payloadKey = NULL;
  if (strcmp(command, "SELECT") == 0) {
    payloadKey = "experienceId";
    payloadField = findField(fields, fieldCount, payloadKey);
  } else if (strcmp(command, "START") == 0 || strcmp(command, "STOP") == 0) {
    payloadKey = "operationId";
    payloadField = findField(fields, fieldCount, payloadKey);
  } else if (strcmp(command, "IDENTIFY") == 0) {
    payloadKey = "protocol";
    payloadField = findField(fields, fieldCount, payloadKey);
  }

  if (payloadKey && (!payloadField ||
      (strcmp(command, "IDENTIFY") == 0 ? payloadField->isString : !payloadField->isString))) {
    rejectCommand(command, requestField->value, "INVALID_SCHEMA");
    return;
  }
  if ((strcmp(command, "SELECT") == 0 || strcmp(command, "START") == 0 ||
       strcmp(command, "STOP") == 0) &&
      !validIdentifier(payloadField->value, MAX_OPERATION_ID_LENGTH)) {
    rejectCommand(command, requestField->value,
      strcmp(command, "SELECT") == 0 ? "UNKNOWN_EXPERIENCE" : "INVALID_OPERATION_ID");
    return;
  }

  const char* payload = payloadField ? payloadField->value : "";
  const uint32_t signature = signatureFor(command, payload);
  const int8_t cachedIndex = findCachedRequest(requestField->value);
  if (cachedIndex >= 0) {
    const CachedAcknowledgement& cached = requestCache[cachedIndex];
    if (cached.signature == signature) {
      sendCachedAcknowledgement(cached);
      if (cached.accepted && strcmp(command, "STATUS_QUERY") == 0) {
        sendStatus(requestField->value);
      }
    } else {
      rejectCommand(command, requestField->value, "REQUEST_ID_REUSED");
    }
    return;
  }

  bool accepted = false;
  const char* code = "";
  const char* operationId = NULL;

  if (strcmp(command, "IDENTIFY") == 0) {
    accepted = strcmp(payload, "2") == 0;
    if (!accepted) code = "UNSUPPORTED_PROTOCOL";
  } else if (strcmp(command, "SELECT") == 0) {
    if (controlState != STATE_IDLE && controlState != STATE_COMPLETED) {
      code = "INVALID_STATE";
    } else if (strcmp(payload, "WIND") == 0) {
      selectedExperience = EXPERIENCE_WIND;
      accepted = true;
    } else if (strcmp(payload, "WAVE") == 0) {
      selectedExperience = EXPERIENCE_WAVE;
      accepted = true;
    } else if (strcmp(payload, "BUBBLE") == 0) {
      selectedExperience = EXPERIENCE_BUBBLE;
      accepted = true;
    } else {
      code = "UNKNOWN_EXPERIENCE";
    }
    if (accepted) {
      controlState = STATE_IDLE;
      elapsedBeforeCurrentAction = 0;
      activeOperationId[0] = '\0';
    }
  } else if (strcmp(command, "START") == 0) {
    if (controlState != STATE_IDLE) {
      code = "INVALID_STATE";
    } else if (selectedExperience == EXPERIENCE_NONE) {
      code = "NO_EXPERIENCE_SELECTED";
    } else if (operationWasUsed(payload)) {
      code = "OPERATION_ID_REUSED";
    } else {
      accepted = true;
      operationId = payload;
      startOperation(payload, millis());
    }
  } else if (strcmp(command, "STOP") == 0) {
    if (controlState != STATE_RUNNING) {
      code = "INVALID_STATE";
    } else if (strcmp(activeOperationId, payload) != 0) {
      code = "OPERATION_MISMATCH";
    } else {
      accepted = true;
      operationId = activeOperationId;
      runActive = false;
      controlState = STATE_STOPPING;
    }
  } else if (strcmp(command, "STATUS_QUERY") == 0) {
    accepted = true;
  } else if (strcmp(command, "RECOVER") == 0) {
    if (controlState != STATE_FAULT) {
      code = "INVALID_STATE";
    } else {
      accepted = true;
      controlState = STATE_IDLE;
      selectedExperience = EXPERIENCE_NONE;
      activeOperationId[0] = '\0';
      elapsedBeforeCurrentAction = 0;
    }
  }

  cacheAcknowledgement(
    requestField->value,
    command,
    signature,
    accepted,
    code,
    operationId
  );
  const CachedAcknowledgement& cached = requestCache[(requestCacheIndex + REQUEST_CACHE_SIZE - 1) % REQUEST_CACHE_SIZE];
  sendCachedAcknowledgement(cached);

  if (accepted && strcmp(command, "START") == 0) {
    operationStartedAt = millis();
    actionDeadline = operationStartedAt;
    beginScheduledAction();
  }
  if (accepted && strcmp(command, "STOP") == 0) {
    char stoppedOperationId[MAX_OPERATION_ID_LENGTH + 1];
    strncpy(stoppedOperationId, operationId, MAX_OPERATION_ID_LENGTH);
    stoppedOperationId[MAX_OPERATION_ID_LENGTH] = '\0';
    controlState = STATE_IDLE;
    elapsedBeforeCurrentAction = 0;
    activeOperationId[0] = '\0';
    sendEvent("STOPPED", stoppedOperationId);
  }
  if (accepted && strcmp(command, "STATUS_QUERY") == 0) {
    sendStatus(requestField->value);
  }
}

void processLine() {
  if (lineTooLong) {
    printError("LINE_TOO_LONG");
  } else {
    inputLine[inputLength] = '\0';
    if (strcmp(inputLine, "PING") == 0) {
      Serial.println(F("PONG"));
    } else if (strcmp(inputLine, "STATUS") == 0) {
      Serial.println(F("STATUS:DIAGNOSTIC_READY"));
    } else if (inputLength > 0 && inputLine[0] == '{') {
      processProtocolCommand(inputLine);
    } else if (inputLength > 0) {
      printError("INVALID_COMMAND");
    }
  }
  inputLength = 0;
  lineTooLong = false;
}

void setup() {
  Serial.begin(BAUD_RATE);
  memset(requestCache, 0, sizeof(requestCache));
  memset(operationHistory, 0, sizeof(operationHistory));
  activeOperationId[0] = '\0';
  Serial.println(F("{\"type\":\"EVENT\",\"name\":\"READY\",\"deviceId\":\"nature-touch-nano-simulation\",\"protocol\":2,\"hardwareOutputsEnabled\":false}"));
}

void loop() {
  while (Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());
    if (incoming == '\r') continue;
    if (incoming == '\n') {
      processLine();
      continue;
    }
    if (!lineTooLong) {
      if (inputLength < LINE_BUFFER_SIZE - 1) {
        inputLine[inputLength++] = incoming;
      } else {
        lineTooLong = true;
      }
    }
  }
  processScheduler(millis());
}
