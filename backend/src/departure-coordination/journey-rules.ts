import { BadRequestException, ConflictException } from "@nestjs/common";

type RiderState = "expected" | "boarded" | "dropped" | "not_riding" | "exception";
export function assertRiderTransition(
  trip: { state: string; direction: string },
  rider: { state: RiderState; boarded_at: Date | null },
  next: Exclude<RiderState, "expected">,
  note: string,
) {
  if (!["boarding", "in_progress"].includes(trip.state)) throw new ConflictException("Open boarding before recording riders.");
  if (["dropped", "not_riding"].includes(rider.state)) throw new ConflictException("This rider outcome is final. Contact school operations for a correction.");
  if (rider.state === next) throw new ConflictException("This rider status is already recorded. Reload the roster.");
  if ((next === "exception" || rider.state === "exception") && note.trim().length < 3) {
    throw new BadRequestException("Describe the concern or how it was resolved before saving.");
  }
  if (next === "not_riding" && rider.boarded_at) throw new ConflictException("A learner who boarded cannot be marked not riding. Record their actual handover.");
  if (next === "dropped" && (!rider.boarded_at || !["boarded", "exception"].includes(rider.state))) throw new ConflictException("Record boarding before handover.");
  if (next === "dropped" && trip.state !== "in_progress") throw new ConflictException("The journey must depart before recording arrival or drop-off.");
  if (next === "boarded" && trip.direction === "from_institution" && trip.state !== "boarding" && rider.state !== "exception") {
    throw new ConflictException("Boarding at school has closed. Contact school operations about a missed rider.");
  }
}

export function assertTripTransition(trip: { state: string; direction: string }, action: string, riders: Array<{ state: string }>, note: string) {
  const allowed = (action === "boarding" && trip.state === "planned") || (action === "start" && trip.state === "boarding")
    || (action === "complete" && trip.state === "in_progress") || (action === "cancel" && ["planned", "boarding"].includes(trip.state));
  if (!allowed) throw new ConflictException(`Trip cannot ${action} from ${trip.state}.`);
  if (action === "cancel") {
    if (note.length < 3) throw new BadRequestException("A cancellation reason is required.");
    if (riders.some(rider => ["boarded", "exception"].includes(rider.state))) throw new ConflictException("Resolve every on-board or exception rider before cancelling.");
  }
  if (action === "complete" && riders.some(rider => ["expected", "boarded", "exception"].includes(rider.state))) {
    throw new ConflictException("Resolve every expected, boarded or exception rider before closing the trip.");
  }
  if (action === "start" && (riders.some(rider => rider.state === "exception") || (trip.direction === "from_institution" && riders.some(rider => rider.state === "expected")))) {
    throw new ConflictException("Account for every rider before departing school. Mark each learner boarded or not riding and resolve concerns.");
  }
  if (["boarding", "start"].includes(action) && !riders.length) throw new ConflictException("Prepare a rider roster before operating this journey.");
}
