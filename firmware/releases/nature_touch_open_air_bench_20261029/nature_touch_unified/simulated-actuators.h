#ifndef NATURE_TOUCH_SIMULATED_ACTUATORS_H
#define NATURE_TOUCH_SIMULATED_ACTUATORS_H

#include <Arduino.h>

// Logical intentions only. There is deliberately no pin, pulse width, driver,
// or physical OFF mapping in this implementation.
namespace ActuatorSimulation {
enum Intent : uint8_t { STOPPED, INFLATING, DEFLATING };

// A small committed snapshot; the host-side virtual test records its history.
// Revision is written last, so even repeated INFLATING calls remain observable.
volatile uint8_t intent = STOPPED;
volatile uint32_t recordedAtMs = 0;
volatile uint16_t commandCount = 0;
volatile uint8_t revision = 0;
// Simulation fault input, normally false. No protocol command exposes injection.
volatile bool faultLatched = false;

void record(Intent next) {
  recordedAtMs = millis();
  intent = next;
  commandCount++;
  revision++;
}

void initializeOutputs() {
  faultLatched = false;
  commandCount = 0;
  revision = 0;
  record(STOPPED);
}

bool inflate() {
  if (faultLatched) return false;
  record(INFLATING);
  return true;
}

bool deflate() {
  if (faultLatched) return false;
  record(DEFLATING);
  return true;
}

void stopAll() {
  record(STOPPED);
}
inline void service(uint32_t) {} // common interface; simulation has no handover
} // namespace ActuatorSimulation

#endif
