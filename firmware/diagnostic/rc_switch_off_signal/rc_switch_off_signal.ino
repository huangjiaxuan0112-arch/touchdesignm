#include <Servo.h>
#include <stdlib.h>
#include <string.h>

const unsigned long BAUD_RATE = 9600;
const size_t LINE_BUFFER_SIZE = 48;

Servo valveSignal;
Servo suctionSignal;
Servo inflationSignal;
char inputLine[LINE_BUFFER_SIZE];
size_t inputLength = 0;
bool lineTooLong = false;
bool isolationConfirmed = false;
uint8_t activePin = 0;
int activeCommand = -1;

Servo* servoForPin(uint8_t pin) {
  if (pin == 5) return &valveSignal;
  if (pin == 6) return &suctionSignal;
  if (pin == 7) return &inflationSignal;
  return NULL;
}

void detachActiveSignal() {
  if (activePin == 0) return;
  servoForPin(activePin)->detach();
  activePin = 0;
  activeCommand = -1;
}

void printHelp() {
  Serial.println(F("Commands: ARM ISOLATED | SET D5|D6|D7 value(0..180) | DISARM | STATUS | HELP"));
  Serial.println(F("A Servo command is a signal request; it does not prove physical OFF."));
}

void processLine() {
  if (lineTooLong) {
    Serial.println(F("ERROR:LINE_TOO_LONG"));
  } else {
    inputLine[inputLength] = '\0';
    char* command = strtok(inputLine, " \t");

    if (command == NULL) {
      inputLength = 0;
      lineTooLong = false;
      return;
    }

    if (strcmp(command, "HELP") == 0 && strtok(NULL, " \t") == NULL) {
      printHelp();
    } else if (strcmp(command, "ARM") == 0) {
      char* confirmation = strtok(NULL, " \t");
      if (confirmation == NULL || strcmp(confirmation, "ISOLATED") != 0 ||
          strtok(NULL, " \t") != NULL) {
        Serial.println(F("ERROR:USE_ARM_ISOLATED"));
      } else {
        isolationConfirmed = true;
        Serial.println(F("ARMED: operator confirmed all pneumatic loads are disconnected."));
        Serial.println(F("This confirmation does not verify physical isolation or switch OFF."));
      }
    } else if (strcmp(command, "SET") == 0) {
      char* channel = strtok(NULL, " \t");
      char* valueText = strtok(NULL, " \t");
      char* extra = strtok(NULL, " \t");
      uint8_t pin = 0;
      if (channel != NULL && strcmp(channel, "D5") == 0) pin = 5;
      if (channel != NULL && strcmp(channel, "D6") == 0) pin = 6;
      if (channel != NULL && strcmp(channel, "D7") == 0) pin = 7;

      char* end = NULL;
      const long value = valueText == NULL ? -1 : strtol(valueText, &end, 10);
      if (!isolationConfirmed) {
        Serial.println(F("ERROR:ARM_WITH_ARM_ISOLATED_FIRST"));
      } else if (pin == 0 || valueText == NULL || end == valueText ||
                 *end != '\0' || value < 0 || value > 180 || extra != NULL) {
        Serial.println(F("ERROR:USE_SET_D5_D6_OR_D7_AND_VALUE_0_TO_180"));
      } else {
        if (activePin != pin) detachActiveSignal();
        Servo* output = servoForPin(pin);
        output->write(static_cast<int>(value));
        if (activePin != pin) {
          const uint8_t channelNumber = output->attach(pin);
          if (channelNumber == INVALID_SERVO) {
            activePin = 0;
            activeCommand = -1;
            Serial.println(F("ERROR:SERVO_ATTACH_FAILED"));
          } else {
            activePin = pin;
            activeCommand = static_cast<int>(value);
            Serial.print(F("SIGNAL_SET pin=D"));
            Serial.print(pin);
            Serial.print(F(" servoCommand="));
            Serial.println(value);
            Serial.println(F("External load measurement is required to determine OFF."));
          }
        } else {
          activeCommand = static_cast<int>(value);
          Serial.print(F("SIGNAL_SET pin=D"));
          Serial.print(pin);
          Serial.print(F(" servoCommand="));
          Serial.println(value);
          Serial.println(F("External load measurement is required to determine OFF."));
        }
      }
    } else if (strcmp(command, "STATUS") == 0 && strtok(NULL, " \t") == NULL) {
      Serial.print(F("isolationConfirmed="));
      Serial.print(isolationConfirmed ? F("yes") : F("no"));
      Serial.print(F(" activePin="));
      if (activePin == 0) Serial.print(F("none"));
      else {
        Serial.print('D');
        Serial.print(activePin);
      }
      Serial.print(F(" servoCommand="));
      if (activeCommand < 0) Serial.println(F("none"));
      else Serial.println(activeCommand);
    } else if (strcmp(command, "DISARM") == 0 && strtok(NULL, " \t") == NULL) {
      detachActiveSignal();
      isolationConfirmed = false;
      Serial.println(F("DISARMED: signal detached; physical OFF is not verified by detach."));
    } else {
      Serial.println(F("ERROR:UNKNOWN_OR_MALFORMED_COMMAND"));
      printHelp();
    }
  }

  inputLength = 0;
  lineTooLong = false;
}

void setup() {
  Serial.begin(BAUD_RATE);
  Serial.println(F("RC switch signal diagnostic; no signal is attached at startup."));
  Serial.println(F("Disconnect all pumps, valves and pneumatic loads from switch outputs."));
  printHelp();
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
}
