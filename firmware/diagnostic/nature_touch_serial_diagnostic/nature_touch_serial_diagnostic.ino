#include <string.h>

const size_t LINE_BUFFER_SIZE = 32;
char inputLine[LINE_BUFFER_SIZE];
size_t inputLength = 0;
bool lineTooLong = false;

void processLine() {
  if (lineTooLong) {
    Serial.println("ERROR:LINE_TOO_LONG");
  } else {
    inputLine[inputLength] = '\0';

    if (strcmp(inputLine, "PING") == 0) {
      Serial.println("PONG");
    } else if (strcmp(inputLine, "STATUS") == 0) {
      Serial.println("STATUS:DIAGNOSTIC_READY");
    } else if (inputLength > 0) {
      Serial.println("ERROR:UNKNOWN_COMMAND");
    }
  }

  inputLength = 0;
  lineTooLong = false;
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  while (Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());

    if (incoming == '\r') {
      continue;
    }

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