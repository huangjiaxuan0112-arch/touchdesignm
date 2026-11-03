#ifndef NATURE_TOUCH_ACTUATOR_DRIVER_H
#define NATURE_TOUCH_ACTUATOR_DRIVER_H

// Simulation is the default. Selecting real cannot bypass source-level interlocks.
#ifndef NATURE_TOUCH_ACTUATOR_DRIVER
#define NATURE_TOUCH_ACTUATOR_DRIVER 0
#endif
#if NATURE_TOUCH_ACTUATOR_DRIVER == 1
#include "real-actuators.h"
static_assert(RealActuators::CONFIGURATION_VERIFIED,
  "Real actuator driver BLOCKED: STOP/transition/power/pressure conditions are not verified.");
namespace Actuators = RealActuators;
#elif NATURE_TOUCH_ACTUATOR_DRIVER == 0
#include "simulated-actuators.h"
namespace Actuators = ActuatorSimulation;
#else
#error "Unsupported actuator driver selection; only simulation (0) and reviewed real (1) exist."
#endif

#endif
