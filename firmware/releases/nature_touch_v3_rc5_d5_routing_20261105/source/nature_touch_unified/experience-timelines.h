#ifndef NATURE_TOUCH_EXPERIENCE_TIMELINES_H
#define NATURE_TOUCH_EXPERIENCE_TIMELINES_H

#include <Arduino.h>
#include <avr/pgmspace.h>

// V3-28S OFFLINE CANDIDATE — UNAPPROVED PHYSICAL TIMING.
// Action timings are commanded intervals, not measured pump-on time.
// This header does not authorize real actuator outputs.

struct ScheduledAction {
  uint16_t durationMs;
  uint8_t inflate;
};

static const ScheduledAction WIND_ACTIONS[] PROGMEM = {
  // INFLATE: T=0ms; FILL
  { 5000, 1 }, // 00000–05000 ms
  // EXPERIENCE: T=5000ms; DRAIN
  { 1600, 0 }, // 05000–06600 ms
  { 1400, 1 }, // 06600–08000 ms
  { 1550, 0 }, // 08000–09550 ms
  { 1150, 1 }, // 09550–10700 ms
  { 2000, 0 }, // 10700–12700 ms
  { 1700, 1 }, // 12700–14400 ms
  { 1850, 0 }, // 14400–16250 ms
  { 1550, 1 }, // 16250–17800 ms
  { 1150, 0 }, // 17800–18950 ms
  { 1050, 1 }, // 18950–20000 ms
  // DEFLATE: T=20000ms; DRAIN
  { 5000, 0 }, // 20000–25000 ms
};

static const ScheduledAction WAVE_ACTIONS[] PROGMEM = {
  // INFLATE: T=0ms; FILL
  { 5000, 1 }, // 00000–05000 ms
  // EXPERIENCE: T=5000ms; DRAIN
  { 2000, 0 }, // 05000–07000 ms
  { 2500, 1 }, // 07000–09500 ms
  { 2000, 0 }, // 09500–11500 ms
  { 2500, 1 }, // 11500–14000 ms
  { 2000, 0 }, // 14000–16000 ms
  { 2500, 1 }, // 16000–18500 ms
  { 1000, 0 }, // 18500–19500 ms
  { 500, 1 }, // 19500–20000 ms
  // DEFLATE: T=20000ms; DRAIN
  { 5000, 0 }, // 20000–25000 ms
};

static const ScheduledAction BUBBLE_ACTIONS[] PROGMEM = {
  // INFLATE: T=0ms; FILL
  { 5000, 1 }, // 00000–05000 ms
  // EXPERIENCE: T=5000ms; DRAIN
  { 1080, 0 }, // 05000–06080 ms
  { 1320, 1 }, // 06080–07400 ms
  { 1215, 0 }, // 07400–08615 ms
  { 1485, 1 }, // 08615–10100 ms
  { 967, 0 }, // 10100–11067 ms
  { 1183, 1 }, // 11067–12250 ms
  { 1282, 0 }, // 12250–13532 ms
  { 1568, 1 }, // 13532–15100 ms
  { 1102, 0 }, // 15100–16202 ms
  { 1348, 1 }, // 16202–17550 ms
  { 1102, 0 }, // 17550–18652 ms
  { 1348, 1 }, // 18652–20000 ms
  // DEFLATE: T=20000ms; DRAIN
  { 5000, 0 }, // 20000–25000 ms
};

#define WIND_ACTION_COUNT (sizeof(WIND_ACTIONS) / sizeof(WIND_ACTIONS[0]))
#define WAVE_ACTION_COUNT (sizeof(WAVE_ACTIONS) / sizeof(WAVE_ACTIONS[0]))
#define BUBBLE_ACTION_COUNT (sizeof(BUBBLE_ACTIONS) / sizeof(BUBBLE_ACTIONS[0]))

#endif
