#ifndef NATURE_TOUCH_EXPERIENCE_TIMELINES_H
#define NATURE_TOUCH_EXPERIENCE_TIMELINES_H

#include <Arduino.h>
#include <avr/pgmspace.h>

// 30S OFFLINE CANDIDATE — UNAPPROVED PHYSICAL TIMING.
// Action timings are commanded intervals, not measured pump-on time.
// This header does not authorize real actuator outputs.

struct ScheduledAction {
  uint16_t durationMs;
  uint8_t inflate;
};

static const ScheduledAction WIND_ACTIONS[] PROGMEM = {
  // INFLATE: T=0ms; FILL
  { 10000, 1 }, // 00000–10000 ms
  // EXPERIENCE: T=10000ms; DRAIN
  { 1600, 0 }, // 10000–11600 ms
  { 1400, 1 }, // 11600–13000 ms
  { 1550, 0 }, // 13000–14550 ms
  { 1150, 1 }, // 14550–15700 ms
  { 2000, 0 }, // 15700–17700 ms
  { 1700, 1 }, // 17700–19400 ms
  { 1850, 0 }, // 19400–21250 ms
  { 1550, 1 }, // 21250–22800 ms
  { 1150, 0 }, // 22800–23950 ms
  { 1050, 1 }, // 23950–25000 ms
  // DEFLATE: T=25000ms; DRAIN
  { 5000, 0 }, // 25000–30000 ms
};

static const ScheduledAction WAVE_ACTIONS[] PROGMEM = {
  // INFLATE: T=0ms; FILL
  { 10000, 1 }, // 00000–10000 ms
  // EXPERIENCE: T=10000ms; DRAIN
  { 2000, 0 }, // 10000–12000 ms
  { 2500, 1 }, // 12000–14500 ms
  { 2000, 0 }, // 14500–16500 ms
  { 2500, 1 }, // 16500–19000 ms
  { 2000, 0 }, // 19000–21000 ms
  { 2500, 1 }, // 21000–23500 ms
  { 1000, 0 }, // 23500–24500 ms
  { 500, 1 }, // 24500–25000 ms
  // DEFLATE: T=25000ms; DRAIN
  { 5000, 0 }, // 25000–30000 ms
};

static const ScheduledAction BUBBLE_ACTIONS[] PROGMEM = {
  // INFLATE: T=0ms; FILL
  { 10000, 1 }, // 00000–10000 ms
  // EXPERIENCE: T=10000ms; DRAIN
  { 1080, 0 }, // 10000–11080 ms
  { 1320, 1 }, // 11080–12400 ms
  { 1215, 0 }, // 12400–13615 ms
  { 1485, 1 }, // 13615–15100 ms
  { 967, 0 }, // 15100–16067 ms
  { 1183, 1 }, // 16067–17250 ms
  { 1282, 0 }, // 17250–18532 ms
  { 1568, 1 }, // 18532–20100 ms
  { 1102, 0 }, // 20100–21202 ms
  { 1348, 1 }, // 21202–22550 ms
  { 1102, 0 }, // 22550–23652 ms
  { 1348, 1 }, // 23652–25000 ms
  // DEFLATE: T=25000ms; DRAIN
  { 5000, 0 }, // 25000–30000 ms
};

#define WIND_ACTION_COUNT (sizeof(WIND_ACTIONS) / sizeof(WIND_ACTIONS[0]))
#define WAVE_ACTION_COUNT (sizeof(WAVE_ACTIONS) / sizeof(WAVE_ACTIONS[0]))
#define BUBBLE_ACTION_COUNT (sizeof(BUBBLE_ACTIONS) / sizeof(BUBBLE_ACTIONS[0]))

#endif
