#ifndef NATURE_TOUCH_ACTUATOR_DRIVER_H
#define NATURE_TOUCH_ACTUATOR_DRIVER_H

// This preparation release cannot select physical outputs, even via build flags.
#ifndef NATURE_TOUCH_ACTUATOR_DRIVER
#define NATURE_TOUCH_ACTUATOR_DRIVER 0
#endif
#if NATURE_TOUCH_ACTUATOR_DRIVER != 0
#error "Real actuator driver BLOCKED: OFF, transition, startup and independent protections are unverified."
#include "real-actuators.h"
namespace Actuators = RealActuators;
#else
#include "simulated-actuators.h"
namespace Actuators = ActuatorSimulation;
#endif

#endif
