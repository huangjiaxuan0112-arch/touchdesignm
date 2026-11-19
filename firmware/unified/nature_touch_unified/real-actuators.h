#ifndef NATURE_TOUCH_REAL_ACTUATORS_H
#define NATURE_TOUCH_REAL_ACTUATORS_H

#include <Arduino.h>
#include <Servo.h>

namespace RealActuators {
// Current configuration USER_CONFIRMED_PASS on 2026-11-04; see approval record in docs/evidence.
// This is user/onsite confirmation, not an assistant measurement or upload authorization.
static constexpr uint8_t D5_PIN = 5, D6_PIN = 6, D7_PIN = 7;
static constexpr uint16_t D5_OFF_US = 1200, D5_ON_US = 1800;
static constexpr uint16_t D5_FILL_PATH_US = 1800; // P <-> A; R blocked
static constexpr uint16_t D5_DRAIN_PATH_US = 1200; // A <-> R; P blocked
static constexpr uint16_t D6_OFF_US = 1200, D6_ON_US = 1800;
static constexpr uint16_t D7_OFF_US = 1200, D7_ON_US = 1800;
static constexpr bool D5_MAPPING_VERIFIED = true;
static constexpr bool D6_MAPPING_VERIFIED = true;
static constexpr bool D7_MAPPING_VERIFIED = true;
// RC5: user confirms a three-port/two-position valve. Requested P/A/R routing:
// P = D6 inflation outlet, A = airbag, R = D7 suction inlet.
// 1800 us selects P-A; 1200 us selects A-R. Neither state opens every port.
// Current flow, residual pressure and independent relief still need onsite acceptance.
static constexpr bool D5_ROUTING_USER_REPORTED = true;
static constexpr bool D7_LATEST_RESET_OBSERVATION_PASSED = true;

// Source locks: no runtime command or build flag grants physical activation.
static constexpr bool PHYSICAL_OUTPUTS_PERMITTED = true;
static constexpr bool D5_D6_OUTPUTS_PERMITTED = true;
static constexpr bool D7_ACTIVATION_REVIEWED = true;
static constexpr bool POWER_CUTOFF_VERIFIED = true;
static constexpr bool OVERPRESSURE_PROTECTION_VERIFIED = true;
static constexpr bool STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED = true;
static constexpr bool INDEPENDENT_PROTECTIONS_VERIFIED =
  POWER_CUTOFF_VERIFIED && OVERPRESSURE_PROTECTION_VERIFIED;

// Current STOP route and pressure/cutoff conditions confirmed applicable by the onsite owner.
// Selection is NOT authorization to attach or emit this signal.
static constexpr uint16_t STOP_VALVE_US = 1200; // USER_CONFIRMED_CURRENT_CONFIGURATION
static constexpr bool STOP_VALVE_VERIFIED = true;
static constexpr uint16_t PUMP_OFF_SETTLE_MS = 500; // USER_CONFIRMED_APPLICABLE; no assistant measurement
static constexpr uint16_t VALVE_SETTLE_MS = 300; // USER_CONFIRMED_APPLICABLE; no assistant measurement
static constexpr bool PUMP_OFF_SETTLE_VERIFIED = true;
static constexpr bool VALVE_SETTLE_VERIFIED = true;
static constexpr bool CONFIGURATION_VERIFIED =
  PHYSICAL_OUTPUTS_PERMITTED && D5_D6_OUTPUTS_PERMITTED && D7_ACTIVATION_REVIEWED &&
  D5_MAPPING_VERIFIED && D6_MAPPING_VERIFIED && D7_MAPPING_VERIFIED &&
  D5_ROUTING_USER_REPORTED && STOP_VALVE_VERIFIED &&
  (STOP_VALVE_US == D5_OFF_US || STOP_VALVE_US == D5_ON_US) &&
  INDEPENDENT_PROTECTIONS_VERIFIED && STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED &&
  PUMP_OFF_SETTLE_VERIFIED && VALVE_SETTLE_VERIFIED;

// RC4: user onsite confirmed D6 inflates, D7 deflates; roles supersede RC3.
struct PhysicalCommand { uint16_t valveUs; uint16_t d6Us; uint16_t d7Us; };
static constexpr PhysicalCommand INFLATE = { D5_FILL_PATH_US, D6_ON_US, D7_OFF_US };
static constexpr PhysicalCommand DEFLATE = { D5_DRAIN_PATH_US, D6_OFF_US, D7_ON_US };
// Existing user confirmation of long READY/Cooldown 1800 us is retained.
// This preselects P-A for the next fill; it is not proof of venting or zero pressure.
static constexpr bool READY_OPEN_PHYSICALLY_VERIFIED = true;
static constexpr bool READY_PREPARATION_ENABLED = READY_OPEN_PHYSICALLY_VERIFIED;
bool faultLatched = true;

class Driver {
 public:
  void initializeOutputs() {
    cancelPending();
    initialized = false;
    faultLatched = true;
    writeStop();
    if (!configurationReady()) return;
    // Prepare all pulses BEFORE attach; never intentionally emit default 1500us.
    pumpD6.writeMicroseconds(D6_OFF_US);
    pumpD7.writeMicroseconds(D7_OFF_US);
    valve.writeMicroseconds(STOP_VALVE_US);
    if (!(attachedMask & 2)) {
      if (pumpD6.attach(D6_PIN) == INVALID_SERVO) { writeStop(); return; }
      attachedMask |= 2;
    }
    if (!(attachedMask & 4)) {
      if (pumpD7.attach(D7_PIN) == INVALID_SERVO) { writeStop(); return; }
      attachedMask |= 4;
    }
    if (!(attachedMask & 1)) {
      if (valve.attach(D5_PIN) == INVALID_SERVO) { writeStop(); return; }
      attachedMask |= 1;
    }
    writeStop();
    initialized = true;
    faultLatched = false;
    allowReadyPreparation();
  }
  bool inflate() { return request(FILL); }
  bool deflate() { return request(DRAIN); }
  bool outputsReady() const { return initialized && attachedMask == 7 && configurationReady(); }
  bool outputsAttached() const { return attachedMask != 0; }
  void stopAll() {
    readyAllowed = false;
    prepared = false;
    cancelPending(); // Cancel BEFORE writes; service cannot release an old ON.
    writeStop(); // Sustained OFF pulses, no detach and no extra drain cycle.
    if (!configurationReady() || !initialized) faultLatched = true;
  }
  void allowReadyPreparation() {
    if (!READY_PREPARATION_ENABLED || !outputsReady() || faultLatched) return;
    readyAllowed = true;
    prepared = false;
    writePumpsOff();
    phase = READY_PUMPS;
    stageAt = pumpsOffAt;
  }
  bool preparedStartReady() const { return prepared; }
  bool preparingReady() const { return readyAllowed; }
  void service(uint32_t now) {
    if (faultLatched || !initialized || !configurationReady()) { stopAll(); return; }
    if (readyAllowed) {
      if (phase == READY_PUMPS && uint32_t(now - stageAt) >= PUMP_OFF_SETTLE_MS) {
        valve.writeMicroseconds(D5_FILL_PATH_US);
        phase = READY_VALVE;
        stageAt = now;
      } else if (phase == READY_VALVE && uint32_t(now - stageAt) >= VALVE_SETTLE_MS) {
        prepared = true;
        phase = IDLE;
      }
      return;
    }
    if (pending == NONE) return;
    if (phase == WAIT_PUMPS) {
      if (uint32_t(now - stageAt) < PUMP_OFF_SETTLE_MS) return;
      const PhysicalCommand& command = pending == FILL ? INFLATE : DEFLATE;
      valve.writeMicroseconds(command.valveUs);
      phase = WAIT_VALVE;
      stageAt = now;
      return;
    }
    if (uint32_t(now - stageAt) < VALVE_SETTLE_MS) return;
    const Mode next = pending;
    pending = NONE;
    phase = IDLE;
    // Both pumps received OFF first; inactive pump stays at OFF.
    if (next == FILL) pumpD6.writeMicroseconds(INFLATE.d6Us);
    else pumpD7.writeMicroseconds(DEFLATE.d7Us);
    pumpCommandOn = true;
    active = next;
  }

 private:
  Servo valve, pumpD6, pumpD7;
  enum Mode : uint8_t { NONE, FILL, DRAIN };
  enum Phase : uint8_t { IDLE, WAIT_PUMPS, WAIT_VALVE, READY_PUMPS, READY_VALVE };
  Mode active = NONE, pending = NONE;
  Phase phase = IDLE;
  uint8_t attachedMask = 0;
  uint32_t stageAt = 0;
  bool initialized = false;
  bool readyAllowed = false, prepared = false;
  bool pumpCommandOn = false, offClockValid = false;
  uint32_t pumpsOffAt = 0;

  bool stopValveReady() const {
    return STOP_VALVE_VERIFIED && (STOP_VALVE_US == D5_OFF_US || STOP_VALVE_US == D5_ON_US);
  }
  bool configurationReady() const {
    return CONFIGURATION_VERIFIED;
  }
  void cancelPending() { pending = NONE; active = NONE; phase = IDLE; }
  void writePumpsOff() {
    if ((attachedMask & 6) && (pumpCommandOn || !offClockValid)) {
      pumpsOffAt = millis();
      offClockValid = true;
    }
    pumpCommandOn = false;
    // OFF is still requested if ON authorization/fault checks fail after attach.
    if (attachedMask & 2) pumpD6.writeMicroseconds(D6_OFF_US);
    if (attachedMask & 4) pumpD7.writeMicroseconds(D7_OFF_US);
  }
  void writeStop() {
    writePumpsOff();
    if (attachedMask & 1) {
      if (stopValveReady()) valve.writeMicroseconds(STOP_VALVE_US);
      else faultLatched = true; // Never guess a valve STOP position.
    }
  }
  bool request(Mode next) {
    if (!configurationReady() || !initialized || faultLatched) {
      stopAll(); faultLatched = true; return false;
    }
    if (next == FILL && prepared) {
      readyAllowed = false;
      prepared = false;
      pending = NONE;
      phase = IDLE;
      pumpD6.writeMicroseconds(D6_ON_US);
      pumpCommandOn = true;
      active = FILL;
      return true;
    }
    readyAllowed = false;
    prepared = false;
    if (next == active || next == pending) return true; // Preserve consecutive fill.
    writePumpsOff(); // OFF-before-ON at the command layer, not measured shutdown.
    active = NONE;
    pending = next;
    phase = WAIT_PUMPS;
    stageAt = pumpsOffAt; // Reuse elapsed OFF time; never restart an already satisfied stop guard.
    return true;
  }
};

static Driver driver;
inline void initializeOutputs() { driver.initializeOutputs(); }
inline bool inflate() { return driver.inflate(); }
inline bool deflate() { return driver.deflate(); }
inline bool outputsReady() { return driver.outputsReady(); }
inline bool hardwareOutputsEnabled() { return driver.outputsAttached(); }
inline void stopAll() { driver.stopAll(); }
inline void allowReadyPreparation() { driver.allowReadyPreparation(); }
inline bool preparedStartReady() { return driver.preparedStartReady(); }
inline bool readyPreparationRequired() { return READY_PREPARATION_ENABLED; }
inline bool preparingReady() { return driver.preparingReady(); }
inline void service(uint32_t now) { driver.service(now); }
} // namespace RealActuators
#endif
