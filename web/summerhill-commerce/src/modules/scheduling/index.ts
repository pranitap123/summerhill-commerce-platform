// Public API of the scheduling module: location settings, closures, pickup slots and holds (G4).
export {
  BOOKING_WINDOW_DAYS,
  DEFAULT_WEEKLY_HOURS,
  GENERATION_DAYS,
  ISO_WEEKDAYS,
  SLOT_MINUTES,
  dateKey,
  dayHoursSchema,
  hoursOn,
  isoWeekday,
  localDate,
  nextOpening,
  plannedSlots,
  slotRejection,
  weeklyHoursSchema,
} from './schedule'
export type {
  DayHours,
  IsoWeekday,
  LocalDate,
  OfferContext,
  ScheduleSettings,
  SlotRejection,
  WeeklyHours,
} from './schedule'
export {
  addClosure,
  generateAllSlots,
  getLocationSettings,
  listClosures,
  listLocationSettings,
  removeClosure,
  updateLocationSettings,
} from './settings'
export type { Closure, LocationSettings, SettingsPatch } from './settings'
export {
  availableSlots,
  bookSlotHold,
  generateSlots,
  getSlot,
  holdSlot,
  listSlots,
  releaseExpiredHolds,
  releaseSlotHold,
} from './slots'
export type { GenerationResult, OfferedSlot, SlotRow } from './slots'
