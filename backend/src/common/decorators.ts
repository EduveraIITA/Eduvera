import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ROUTE = "omnischool:public";
export const SKIP_CSRF = "omnischool:skip-csrf";
export const LIVE_ACCOUNT_CONTROL = "thatcampus:live-account-control";
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
export const SkipCsrf = () => SetMetadata(SKIP_CSRF, true);
/** Public account ceremonies must still honour an existing session's world. */
export const LiveAccountControl = () => SetMetadata(LIVE_ACCOUNT_CONTROL, true);
