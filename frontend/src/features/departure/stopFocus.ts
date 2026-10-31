import { applicationNow } from "../simulation/applicationTime";
import { stopFocus as selectedWorldStopFocus, type DepartureFocusTrip, type RiderStop } from "../../../../packages/contracts/src/departure-stop-focus";
export { coordinates, distanceMetres, riderStops } from "../../../../packages/contracts/src/departure-stop-focus";
export type { RiderStop } from "../../../../packages/contracts/src/departure-stop-focus";
export function stopFocus(trip:DepartureFocusTrip,groups:RiderStop[],now=applicationNow().getTime()) { return selectedWorldStopFocus(trip,groups,now); }
