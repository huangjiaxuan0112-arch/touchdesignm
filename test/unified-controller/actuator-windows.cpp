// Compiled only against the offline millis/Servo stubs in verify-actuator-windows.mjs.
#include "experience-timelines.h"
#include "real-actuators.h"

uint32_t fixtureMillis;
uint16_t fixturePulses[8];
volatile uint8_t fixtureResult;

static bool pumps(bool inflate, bool on) {
  return fixturePulses[6] == (inflate && on ? 1800 : 1200)
      && fixturePulses[7] == (!inflate && on ? 1800 : 1200);
}

static bool stopped() {
  return pumps(false, false) && fixturePulses[5] == 1200;
}

static bool prepare(RealActuators::Driver& driver) {
  fixtureMillis = 0;
  driver.initializeOutputs();
  if (!stopped()) return false;
  for (; fixtureMillis <= 800; ++fixtureMillis) {
    driver.service(fixtureMillis);
    if (!pumps(true, false) || fixturePulses[5] != (fixtureMillis < 500 ? 1200 : 1800)) return false;
  }
  return driver.preparedStartReady();
}

static bool checkWindows(const ScheduledAction* actions, uint8_t count) {
  RealActuators::Driver driver;
  if (!prepare(driver)) return false;
  const uint32_t started = fixtureMillis;
  uint16_t priorDuration = 0;
  for (uint8_t i = 0; i < count; ++i) {
    const bool inflate = pgm_read_byte(&actions[i].inflate) != 0;
    const uint16_t duration = pgm_read_word(&actions[i].durationMs);
    // The short WAVE fill never energizes a pump. The next drain reuses its OFF time.
    const uint16_t onAfter = i == 0 ? 0 : priorDuration == 500 ? 300 : 800;
    // The scheduler services the driver before issuing the next request at a boundary.
    driver.service(fixtureMillis);
    if (!(inflate ? driver.inflate() : driver.deflate())) return false;
    for (uint16_t offset = 0; offset < duration; ++offset, ++fixtureMillis) {
      driver.service(fixtureMillis);
      const bool on = offset >= onAfter;
      if (!pumps(inflate, on)) return false;
      if (on && fixturePulses[5] != (inflate ? 1800 : 1200)) return false;
    }
    priorDuration = duration;
  }
  if (fixtureMillis - started != 30000) return false;
  driver.stopAll();
  for (uint16_t i = 0; i < 1000; ++i, ++fixtureMillis) {
    driver.service(fixtureMillis);
    if (!stopped()) return false;
  }
  return true;
}

static bool checkCancellation(uint16_t cancelAt, bool fault) {
  RealActuators::Driver driver;
  if (!prepare(driver) || !driver.inflate()) return false;
  fixtureMillis += 1000;
  if (!driver.deflate()) return false;
  const uint32_t reversal = fixtureMillis;
  while (fixtureMillis - reversal < cancelAt) {
    driver.service(fixtureMillis);
    ++fixtureMillis;
  }
  if (!pumps(true, false) || fixturePulses[5] != (cancelAt < 500 ? 1800 : 1200)) return false;
  if (fault) RealActuators::faultLatched = true;
  else driver.stopAll();
  for (; fixtureMillis - reversal < 1500; ++fixtureMillis) {
    driver.service(fixtureMillis);
    if (!stopped()) return false;
  }
  return true;
}

int main() {
  if (!checkWindows(WIND_ACTIONS, WIND_ACTION_COUNT)) fixtureResult = 1;
  else if (!checkWindows(WAVE_ACTIONS, WAVE_ACTION_COUNT)) fixtureResult = 2;
  else if (!checkWindows(BUBBLE_ACTIONS, BUBBLE_ACTION_COUNT)) fixtureResult = 3;
  else if (!checkCancellation(250, false)) fixtureResult = 4;
  else if (!checkCancellation(650, false)) fixtureResult = 5;
  else if (!checkCancellation(250, true)) fixtureResult = 6;
  else if (!checkCancellation(650, true)) fixtureResult = 7;
  else fixtureResult = 255;
  return 0;
}
