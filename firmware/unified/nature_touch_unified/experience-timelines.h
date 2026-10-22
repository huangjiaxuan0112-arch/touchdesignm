#ifndef NATURE_TOUCH_EXPERIENCE_TIMELINES_H
#define NATURE_TOUCH_EXPERIENCE_TIMELINES_H

#include <Arduino.h>
#include <avr/pgmspace.h>

struct ScheduledAction {
  uint16_t durationMs;
  uint8_t inflate;
};

static const ScheduledAction WIND_ACTIONS[] PROGMEM = {
  { 5000, 1 }, { 1500, 0 }, { 1300, 1 }, { 1450, 0 },
  { 1050, 1 }, { 1900, 0 }, { 1600, 1 }, { 1750, 0 },
  { 1450, 1 }, { 1050, 0 }, { 950, 1 }, { 5000, 0 }
};

static const ScheduledAction WAVE_ACTIONS[] PROGMEM = {
  { 5000, 1 }, { 2000, 0 }, { 2500, 1 }, { 2000, 0 },
  { 2500, 1 }, { 2000, 0 }, { 2500, 1 }, { 1000, 0 },
  { 500, 1 }, { 5000, 0 }
};

static const ScheduledAction BUBBLE_ACTIONS[] PROGMEM = {
  { 4420, 1 }, { 580, 1 },
  { 657, 0 }, { 803, 1 }, { 670, 0 }, { 820, 1 },
  { 891, 0 }, { 1089, 1 }, { 850, 0 }, { 1040, 1 },
  { 900, 0 }, { 1100, 1 }, { 823, 0 }, { 1007, 1 },
  { 819, 0 }, { 1001, 1 }, { 225, 0 }, { 275, 1 },
  { 1066, 0 }, { 1304, 1 }, { 342, 0 }, { 418, 1 },
  { 378, 0 }, { 462, 1 }, { 252, 0 }, { 308, 1 },
  { 243, 0 }, { 297, 1 }, { 621, 0 }, { 759, 1 },
  { 3000, 0 }
};

#define WIND_ACTION_COUNT (sizeof(WIND_ACTIONS) / sizeof(WIND_ACTIONS[0]))
#define WAVE_ACTION_COUNT (sizeof(WAVE_ACTIONS) / sizeof(WAVE_ACTIONS[0]))
#define BUBBLE_ACTION_COUNT (sizeof(BUBBLE_ACTIONS) / sizeof(BUBBLE_ACTIONS[0]))

#endif
