#ifndef NATURE_TOUCH_EXPERIENCE_SCHEDULER_H
#define NATURE_TOUCH_EXPERIENCE_SCHEDULER_H

// Scheduling uses the single runtime state declared by the sketch.
void beginScheduledAction() {
  const ScheduledAction* timeline = currentTimeline();
  if (!runActive || controlState != STATE_RUNNING) return;
  if (!timeline || actionIndex >= actionCount) {
    enterFault("INVALID_TIMELINE");
    return;
  }
  const ScheduledAction action = {
    pgm_read_word(&timeline[actionIndex].durationMs),
    pgm_read_byte(&timeline[actionIndex].inflate)
  };
  if (!(action.inflate ? Actuators::inflate() : Actuators::deflate())) {
    enterFault("ACTUATOR_FAULT");
    return;
  }
  pendingActionEvents |= (1UL << actionIndex);
  actionDeadline += action.durationMs;
  actionScheduled = true;
}

void startOperation(const char* operationId, uint32_t now) {
  strncpy(activeOperationId, operationId, MAX_OPERATION_ID_LENGTH);
  activeOperationId[MAX_OPERATION_ID_LENGTH] = '\0';
  rememberOperation(operationId);
  operationStartedAt = now;
  actionDeadline = now;
  elapsedBeforeCurrentAction = 0;
  actionIndex = 0;
  actionCount = currentActionCount();
  runActive = true;
  actionScheduled = false;
  pendingActionEvents = 0;
  completionEventPending = false;
  controlState = STATE_RUNNING;
  lastHostContactAt = now;
}

void processScheduler(uint32_t now) {
  processSafety(now);
  if (!runActive || !actionScheduled || static_cast<int32_t>(now - actionDeadline) < 0) return;

  const ScheduledAction* timeline = currentTimeline();
  if (!timeline || actionIndex >= actionCount) {
    enterFault("INVALID_TIMELINE");
    return;
  }
  const uint16_t previousDuration = pgm_read_word(&timeline[actionIndex].durationMs);
  elapsedBeforeCurrentAction += previousDuration;
  actionIndex++;

  if (actionIndex >= actionCount) {
    runActive = false;
    actionScheduled = false;
    Actuators::stopAll();
    controlState = STATE_COMPLETED;
    completionEventPending = true;
    return;
  }

  beginScheduledAction();
}

#endif
