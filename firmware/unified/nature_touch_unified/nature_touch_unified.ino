#include <string.h>
#include "experience-timelines.h"
#include "actuator-driver.h"

// Simulation is the default; the real build uses the same protocol and scheduler.
// The real selector requires reviewed source-level shutdown/protection conditions.
const uint8_t LINE_BUFFER_SIZE = 160;
const uint8_t MAX_FIELDS = 6;
const uint8_t MAX_REQUEST_ID_LENGTH = 16;
const uint8_t MAX_OPERATION_ID_LENGTH = 16;
const uint8_t REQUEST_CACHE_SIZE = 4;
const uint8_t OPERATION_HISTORY_SIZE = 4;
const uint8_t PROTOCOL_VERSION = 2;
const unsigned long BAUD_RATE = 9600;
// Existing Windows STATUS_QUERY heartbeats normally arrive every 1000 ms.
// This is a protocol lease, not an electrical USB disconnect detector.
const uint32_t HOST_TIMEOUT_MS = 5000;

char inputLine[LINE_BUFFER_SIZE];
uint8_t inputLength = 0;
bool lineTooLong = false;
bool inputLineReady = false;

void collectSerialInput();
void processScheduler(uint32_t now);

// Keep JSON frames intact while allowing RX and logical deadlines to progress.
// Only the main loop serializes replies/events; this writer never parses commands.
class CooperativeProtocolWriter : public Print {
 public:
  size_t write(uint8_t value) override {
    collectSerialInput();
    processScheduler(millis());
    while (Serial.availableForWrite() == 0) {
      collectSerialInput();
      processScheduler(millis());
    }
    return Serial.write(value);
  }
};
CooperativeProtocolWriter ProtocolOutput;

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
uint32_t lastHostContactAt = 0;
const char* faultCode = NULL;
bool actionScheduled = false;
uint32_t pendingActionEvents = 0;
bool completionEventPending = false;
bool faultEventPending = false;
static_assert(WIND_ACTION_COUNT <= 32 && WAVE_ACTION_COUNT <= 32 && BUBBLE_ACTION_COUNT <= 32,
  "Diagnostic pending mask supports at most 32 actions per timeline");

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
    if (*cursor == '"' || *cursor == '\\') ProtocolOutput.write('\\');
    ProtocolOutput.write(*cursor);
  }
}

void printError(const char* code) {
  ProtocolOutput.print(F("{\"type\":\"ERROR\",\"code\":\""));
  printEscaped(code);
  ProtocolOutput.println(F("\"}"));
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
  ProtocolOutput.print(F("{\"type\":\""));
  ProtocolOutput.print(type);
  ProtocolOutput.print(F("\",\"command\":\""));
  ProtocolOutput.print(command);
  ProtocolOutput.print(F("\",\"accepted\":"));
  ProtocolOutput.print(accepted ? F("true") : F("false"));
  ProtocolOutput.print(F(",\"requestId\":\""));
  printEscaped(requestId);
  ProtocolOutput.print(F("\",\"state\":\""));
  ProtocolOutput.print(stateName(state));
  ProtocolOutput.print(F("\""));
  if (operationId && operationId[0]) {
    ProtocolOutput.print(F(",\"operationId\":\""));
    printEscaped(operationId);
    ProtocolOutput.print(F("\""));
  }
  if (code && code[0]) {
    ProtocolOutput.print(F(",\"code\":\""));
    printEscaped(code);
    ProtocolOutput.print(F("\""));
  }
  if (includeIdentity) {
    ProtocolOutput.print(F(",\"protocol\":"));
    ProtocolOutput.print(PROTOCOL_VERSION);
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
    ProtocolOutput.print(F(",\"firmware\":\"nature-touch-unified-real\""));
    ProtocolOutput.print(F(",\"deviceId\":\"nature-touch-nano-real\""));
    ProtocolOutput.print(F(",\"hardwareOutputsEnabled\":"));
    ProtocolOutput.print(Actuators::hardwareOutputsEnabled() ? F("true") : F("false"));
    ProtocolOutput.print(F(",\"capabilities\":[\"WIND\",\"WAVE\",\"BUBBLE\",\"REAL_ACTUATORS\"]"));
#else
    ProtocolOutput.print(F(",\"firmware\":\"nature-touch-unified-simulation\""));
    ProtocolOutput.print(F(",\"deviceId\":\"nature-touch-nano-simulation\""));
    ProtocolOutput.print(F(",\"hardwareOutputsEnabled\":false"));
    ProtocolOutput.print(F(",\"capabilities\":[\"WIND\",\"WAVE\",\"BUBBLE\",\"SIMULATION_ONLY\"]"));
#endif
  }
  ProtocolOutput.println(F("}"));
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
  ProtocolOutput.print(F("{\"type\":\"EVENT\",\"name\":\""));
  ProtocolOutput.print(name);
  ProtocolOutput.print(F("\",\"operationId\":\""));
  printEscaped(operationId);
  ProtocolOutput.print(F("\""));
  if (strcmp(name, "COMPLETED") == 0) {
    ProtocolOutput.print(F(",\"experienceId\":\""));
    ProtocolOutput.print(experienceName(selectedExperience));
    ProtocolOutput.print(F("\""));
  }
  if (strcmp(name, "FAULT") == 0 && faultCode) {
    ProtocolOutput.print(F(",\"code\":\""));
    printEscaped(faultCode);
    ProtocolOutput.print(F("\""));
  }
  ProtocolOutput.println(F("}"));
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
  const ControlState snapshotState = controlState;
  const char* snapshotFault = faultCode;
  const uint32_t elapsed = elapsedTime(millis());
  const uint16_t duration = currentDuration();
  ProtocolOutput.print(F("{\"type\":\"STATUS\",\"requestId\":\""));
  printEscaped(requestId);
  ProtocolOutput.print(F("\",\"acknowledgement\":{\"type\":\"ACK\",\"command\":\"STATUS_QUERY\",\"accepted\":true,\"requestId\":\""));
  printEscaped(requestId);
  ProtocolOutput.print(F("\",\"state\":\""));
  ProtocolOutput.print(stateName(snapshotState));
  ProtocolOutput.print(F("\"},\"snapshot\":{\"state\":\""));
  ProtocolOutput.print(stateName(snapshotState));
  ProtocolOutput.print(F("\",\"selectedExperienceId\":"));
  if (selectedExperience == EXPERIENCE_NONE) ProtocolOutput.print(F("null"));
  else {
    ProtocolOutput.print(F("\""));
    ProtocolOutput.print(experienceName(selectedExperience));
    ProtocolOutput.print(F("\""));
  }
  ProtocolOutput.print(F(",\"operationId\":"));
  if (activeOperationId[0]) {
    ProtocolOutput.print(F("\""));
    printEscaped(activeOperationId);
    ProtocolOutput.print(F("\""));
  } else {
    ProtocolOutput.print(F("null"));
  }
  ProtocolOutput.print(F(",\"elapsedMs\":"));
  ProtocolOutput.print(elapsed);
  ProtocolOutput.print(F(",\"durationMs\":"));
  if (duration) ProtocolOutput.print(duration);
  else ProtocolOutput.print(F("null"));
  ProtocolOutput.print(F(",\"faultCode\":"));
  if (snapshotFault) {
    ProtocolOutput.print(F("\""));
    printEscaped(snapshotFault);
    ProtocolOutput.print(F("\""));
  } else ProtocolOutput.print(F("null"));
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
  ProtocolOutput.print(F(",\"hardwareOutputsEnabled\":"));
  ProtocolOutput.print(Actuators::hardwareOutputsEnabled() ? F("true") : F("false"));
  ProtocolOutput.print(F("}}\r\n"));
#else
  ProtocolOutput.print(F(",\"hardwareOutputsEnabled\":false}}\r\n"));
#endif
}

void enterFault(const char* code) {
  if (controlState == STATE_FAULT) return;
  elapsedBeforeCurrentAction = elapsedTime(millis());
  runActive = false;
  actionScheduled = false;
  pendingActionEvents = 0;
  completionEventPending = false;
  Actuators::stopAll();
  faultCode = code;
  controlState = STATE_FAULT;
  faultEventPending = true;
}

void processSafety(uint32_t now) {
  if (Actuators::faultLatched && controlState != STATE_FAULT) {
    enterFault("ACTUATOR_FAULT");
  } else if (runActive && static_cast<uint32_t>(now - lastHostContactAt) >= HOST_TIMEOUT_MS) {
    enterFault("HOST_TIMEOUT");
  }
  // Cancel/fault first; never release a pending pump handover after timeout.
  if (runActive && controlState == STATE_RUNNING) Actuators::service(now);
}

void sendActionEvent(uint32_t atMs, uint16_t durationMs, bool inflate) {
  ProtocolOutput.print(F("{\"type\":\"EVENT\",\"name\":\"ACTUATOR_EVENT\",\"operationId\":\""));
  printEscaped(activeOperationId);
  ProtocolOutput.print(F("\",\"experienceId\":\""));
  ProtocolOutput.print(experienceName(selectedExperience));
  ProtocolOutput.print(F("\",\"atMs\":"));
  ProtocolOutput.print(atMs);
  ProtocolOutput.print(F(",\"action\":\""));
  ProtocolOutput.print(inflate ? F("INFLATE") : F("DEFLATE"));
  ProtocolOutput.print(F("\",\"durationMs\":"));
  ProtocolOutput.print(durationMs);
  ProtocolOutput.print(F(",\"D5\":"));
  ProtocolOutput.print(inflate ? 180 : 0);
  ProtocolOutput.print(F(",\"D6\":"));
  ProtocolOutput.print(inflate ? 180 : 0);
  ProtocolOutput.print(F(",\"D7\":"));
  ProtocolOutput.print(inflate ? 0 : 180);
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
  ProtocolOutput.print(F(",\"hardwareOutputsEnabled\":"));
  ProtocolOutput.print(Actuators::hardwareOutputsEnabled() ? F("true") : F("false"));
  ProtocolOutput.println(F("}"));
#else
  ProtocolOutput.println(F(",\"hardwareOutputsEnabled\":false}"));
#endif
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

  ProtocolOutput.print(F("{\"type\":\"EVENT\",\"name\":\"MARKER\",\"operationId\":\""));
  printEscaped(activeOperationId);
  ProtocolOutput.print(F("\",\"experienceId\":\""));
  ProtocolOutput.print(experienceName(selectedExperience));
  ProtocolOutput.print(F("\",\"atMs\":"));
  ProtocolOutput.print(atMs);
  ProtocolOutput.print(F(",\"text\":\""));
  ProtocolOutput.print(marker);
  ProtocolOutput.println(F("\"}"));
}

void beginScheduledAction() {
  const ScheduledAction* timeline = currentTimeline();
  if (!runActive || controlState != STATE_RUNNING) return;
  if (!timeline || actionIndex >= actionCount) {
    enterFault("INVALID_TIMELINE");
    return;
  }
  const ScheduledAction action = {
    pgm_read_word(&timeline[actionIndex].durationMs),
    pgm_read_byte(&timeline[actionIndex].inflate)
  };
  if (!(action.inflate ? Actuators::inflate() : Actuators::deflate())) {
    enterFault("ACTUATOR_FAULT");
    return;
  }
  pendingActionEvents |= (1UL << actionIndex);
  actionDeadline += action.durationMs;
  actionScheduled = true;
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
  actionScheduled = false;
  pendingActionEvents = 0;
  completionEventPending = false;
  controlState = STATE_RUNNING;
  lastHostContactAt = now;
}

void processScheduler(uint32_t now) {
  processSafety(now);
  if (!runActive || !actionScheduled || static_cast<int32_t>(now - actionDeadline) < 0) return;

  const ScheduledAction* timeline = currentTimeline();
  if (!timeline || actionIndex >= actionCount) {
    enterFault("INVALID_TIMELINE");
    return;
  }
  const uint16_t previousDuration = pgm_read_word(&timeline[actionIndex].durationMs);
  elapsedBeforeCurrentAction += previousDuration;
  actionIndex++;

  if (actionIndex >= actionCount) {
    runActive = false;
    actionScheduled = false;
    Actuators::stopAll();
    controlState = STATE_COMPLETED;
    completionEventPending = true;
    return;
  }

  beginScheduledAction();
}

// Drain diagnostic events separately from logical control. A 32-bit pending mask
// retains all 31 BUBBLE actions, including its consecutive inflation calls.
void flushScheduledTelemetry() {
  if (faultEventPending) {
    faultEventPending = false;
    sendEvent("FAULT", activeOperationId);
    return;
  }
  if (pendingActionEvents) {
    const ScheduledAction* timeline = currentTimeline();
    uint32_t atMs = 0;
    for (uint8_t index = 0; index < actionCount; index++) {
      const uint16_t durationMs = pgm_read_word(&timeline[index].durationMs);
      const uint32_t bit = 1UL << index;
      if (pendingActionEvents & bit) {
        pendingActionEvents &= ~bit;
        sendTimelineMarker(atMs);
        // A fault may be latched while the marker is being transmitted.
        if (controlState != STATE_FAULT) {
          sendActionEvent(atMs, durationMs, pgm_read_byte(&timeline[index].inflate) != 0);
        }
        return;
      }
      atMs += durationMs;
    }
  }
  if (completionEventPending) {
    completionEventPending = false;
    ProtocolOutput.print(F("{\"type\":\"EVENT\",\"name\":\"MARKER\",\"operationId\":\""));
    printEscaped(activeOperationId);
    ProtocolOutput.print(F("\",\"experienceId\":\""));
    ProtocolOutput.print(experienceName(selectedExperience));
    ProtocolOutput.print(F("\",\"atMs\":"));
    ProtocolOutput.print(currentDuration());
    ProtocolOutput.print(F(",\"text\":\""));
    if (selectedExperience == EXPERIENCE_WIND) ProtocolOutput.print(F("NEXT WIND CYCLE"));
    else if (selectedExperience == EXPERIENCE_WAVE) ProtocolOutput.print(F("NEXT WAVE CYCLE"));
    else ProtocolOutput.print(F("NEXT ROUND"));
    ProtocolOutput.println(F("\"}"));
    sendEvent("COMPLETED", activeOperationId);
    return;
  }

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
  const bool parsed = parseJsonObject(line, fields, fieldCount);
  // Fields now own the command; RX can collect the next request during printing.
  inputLength = 0;
  lineTooLong = false;
  inputLineReady = false;
  if (!parsed) {
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
      if (cached.accepted) lastHostContactAt = millis();
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

  // Complete old diagnostic frames under their original mode/operation identity
  // before a new selection can replace that context.
  if (strcmp(command, "SELECT") == 0 && controlState == STATE_COMPLETED) {
    while (pendingActionEvents || completionEventPending) flushScheduledTelemetry();
  }

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
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
    if (!Actuators::outputsReady()) {
      code = "ACTUATOR_NOT_READY";
    } else
#endif
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
      actionScheduled = false;
      pendingActionEvents = 0;
      completionEventPending = false;
      Actuators::stopAll();
      controlState = STATE_STOPPING;
    }
  } else if (strcmp(command, "STATUS_QUERY") == 0) {
    accepted = true;
  } else if (strcmp(command, "RECOVER") == 0) {
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
    if (!Actuators::outputsReady()) {
      code = "ACTUATOR_NOT_READY";
    } else
#endif
    if (controlState != STATE_FAULT) {
      code = "INVALID_STATE";
    } else {
      accepted = true;
      runActive = false;
      actionScheduled = false;
      pendingActionEvents = 0;
      completionEventPending = false;
      faultEventPending = false;
      Actuators::stopAll();
      Actuators::faultLatched = false;
      faultCode = NULL;
      controlState = STATE_IDLE;
      selectedExperience = EXPERIENCE_NONE;
      activeOperationId[0] = '\0';
      elapsedBeforeCurrentAction = 0;
    }
  }

  if (accepted) lastHostContactAt = millis();
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
    lastHostContactAt = operationStartedAt;
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
  inputLine[inputLength] = '\0';
  if (!lineTooLong && inputLength > 0 && inputLine[0] == '{') {
    processProtocolCommand(inputLine);
    return;
  }
  const bool tooLong = lineTooLong;
  const bool ping = strcmp(inputLine, "PING") == 0;
  const bool status = strcmp(inputLine, "STATUS") == 0;
  const bool nonempty = inputLength > 0;
  inputLength = 0;
  lineTooLong = false;
  inputLineReady = false;
  if (tooLong) {
    printError("LINE_TOO_LONG");
  } else {
    if (ping) {
      ProtocolOutput.println(F("PONG"));
    } else if (status) {
      ProtocolOutput.println(F("STATUS:DIAGNOSTIC_READY"));
    } else if (nonempty) {
      printError("INVALID_COMMAND");
    }
  }
}

void setup() {
  Actuators::initializeOutputs();
  Serial.begin(BAUD_RATE);
  memset(requestCache, 0, sizeof(requestCache));
  memset(operationHistory, 0, sizeof(operationHistory));
  activeOperationId[0] = '\0';
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
  ProtocolOutput.print(F("{\"type\":\"EVENT\",\"name\":\"READY\",\"deviceId\":\"nature-touch-nano-real\",\"protocol\":2,\"hardwareOutputsEnabled\":"));
  ProtocolOutput.print(Actuators::hardwareOutputsEnabled() ? F("true") : F("false"));
  ProtocolOutput.println(F("}"));
#else
  ProtocolOutput.println(F("{\"type\":\"EVENT\",\"name\":\"READY\",\"deviceId\":\"nature-touch-nano-simulation\",\"protocol\":2,\"hardwareOutputsEnabled\":false}"));
#endif
}

void collectSerialInput() {
  while (!inputLineReady && Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());
    if (incoming == '\r') continue;
    if (incoming == '\n') {
      inputLineReady = true;
      return;
    }
    if (!lineTooLong) {
      if (inputLength < LINE_BUFFER_SIZE - 1) {
        inputLine[inputLength++] = incoming;
      } else {
        lineTooLong = true;
      }
    }
  }
}

void loop() {
  processSafety(millis());
  collectSerialInput();
  if (inputLineReady) processLine();
  processScheduler(millis());
  flushScheduledTelemetry();
}
