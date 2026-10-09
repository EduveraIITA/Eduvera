import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { sendTripLocation } from "./api";
import { useJourneyTracking } from "./useJourneyTracking";
import { StrictMode } from "react";
vi.mock("./api",()=>({sendTripLocation:vi.fn()}));
const send=vi.mocked(sendTripLocation);
let position:PositionCallback;
let failure:PositionErrorCallback;
const clearWatch=vi.fn();
const watchPosition=vi.fn((success:PositionCallback,error?:PositionErrorCallback|null)=>{position=success;failure=error!;return 1;});
beforeEach(()=>{
  vi.clearAllMocks();send.mockResolvedValue({accepted:true});
  Object.defineProperty(navigator,"geolocation",{configurable:true,value:{watchPosition,clearWatch}});
  Object.defineProperty(document,"hidden",{configurable:true,value:false});
});
afterEach(cleanup);
const sample=()=>({timestamp:Date.now(),coords:{latitude:12.9,longitude:77.6,accuracy:10,heading:null,speed:null}} as GeolocationPosition);
describe("journey-bound foreground location",()=>{
  it("does not claim sharing before the server accepts a sample",async()=>{
    const onSample=vi.fn();const {result}=renderHook(()=>useJourneyTracking("trip-a",true,onSample));
    await waitFor(()=>expect(result.current.status).toBe("starting"));expect(watchPosition).toHaveBeenCalledOnce();
    await act(async()=>{position(sample());await Promise.resolve();});await waitFor(()=>expect(result.current.status).toBe("sharing"));
    expect(send).toHaveBeenCalledWith("trip-a",expect.objectContaining({latitude:12.9}));expect(onSample).toHaveBeenCalledOnce();
  });
  it("clears the old watcher and ignores late callbacks after switching journeys",async()=>{
    const {result,rerender}=renderHook(({id})=>useJourneyTracking(id,true,vi.fn()),{initialProps:{id:"trip-a"}});
    await waitFor(()=>expect(result.current.status).toBe("starting"));const oldPosition=position;rerender({id:"trip-b"});
    expect(clearWatch).toHaveBeenCalledWith(1);expect(result.current.status).toBe("paused");
    await act(async()=>{oldPosition(sample());await Promise.resolve();});expect(send).not.toHaveBeenCalled();
    await waitFor(()=>expect(watchPosition).toHaveBeenCalledTimes(2));await act(async()=>{position(sample());await Promise.resolve();});expect(send).toHaveBeenCalledWith("trip-b",expect.anything());
  });
  it("pauses when hidden and automatically resumes on returning",async()=>{
    const {result}=renderHook(()=>useJourneyTracking("trip",true,vi.fn()));await waitFor(()=>expect(result.current.status).toBe("starting"));
    Object.defineProperty(document,"hidden",{configurable:true,value:true});act(()=>{document.dispatchEvent(new Event("visibilitychange"));});
    expect(result.current.running).toBe(false);expect(result.current.message).toMatch(/return/);expect(clearWatch).toHaveBeenCalled();
    Object.defineProperty(document,"hidden",{configurable:true,value:false});act(()=>{document.dispatchEvent(new Event("visibilitychange"));});expect(watchPosition).toHaveBeenCalledTimes(2);expect(result.current.running).toBe(true);
  });
  it("cannot start on a closed trip",async()=>{
    const {result}=renderHook(()=>useJourneyTracking("trip",false,vi.fn()));await act(()=>result.current.start());expect(watchPosition).not.toHaveBeenCalled();
  });
  it("reports denied permission and clears its watcher",async()=>{
    const {result,rerender}=renderHook(()=>useJourneyTracking("trip",true,vi.fn()));await waitFor(()=>expect(result.current.status).toBe("starting"));act(()=>failure({code:1} as GeolocationPositionError));
    expect(result.current.message).toMatch(/denied/);expect(result.current.status).toBe("unavailable");expect(clearWatch).toHaveBeenCalled();
    rerender();act(()=>{document.dispatchEvent(new Event("visibilitychange"));});expect(watchPosition).toHaveBeenCalledOnce();
    await act(()=>result.current.start());expect(watchPosition).toHaveBeenCalledTimes(2);
  });
  it("keeps rejected samples distinct from shared location",async()=>{
    send.mockResolvedValue({accepted:false,reason:"too_frequent"});const onSample=vi.fn();const {result}=renderHook(()=>useJourneyTracking("trip",true,onSample));
    await waitFor(()=>expect(result.current.status).toBe("starting"));await act(async()=>{position(sample());await Promise.resolve();});expect(result.current.status).toBe("starting");expect(onSample).not.toHaveBeenCalled();
  });
  it("automatically starts only when the ride becomes active and stops on completion",async()=>{
    const {result,rerender}=renderHook(({active})=>useJourneyTracking("trip",active,vi.fn()),{initialProps:{active:false}});
    await act(async()=>{});expect(watchPosition).not.toHaveBeenCalled();rerender({active:true});await waitFor(()=>expect(result.current.status).toBe("starting"));
    const oldPosition=position;rerender({active:false});expect(result.current.running).toBe(false);expect(clearWatch).toHaveBeenCalledWith(1);
    await act(async()=>{oldPosition(sample());await Promise.resolve();});expect(send).not.toHaveBeenCalled();
  });
  it("respects a manual pause across polling and visibility changes",async()=>{
    const {result,rerender}=renderHook(()=>useJourneyTracking("trip",true,vi.fn()));await waitFor(()=>expect(result.current.status).toBe("starting"));
    act(()=>result.current.stop());rerender();act(()=>{document.dispatchEvent(new Event("visibilitychange"));});expect(watchPosition).toHaveBeenCalledOnce();expect(result.current.status).toBe("paused");
    await act(()=>result.current.start());expect(watchPosition).toHaveBeenCalledTimes(2);
  });
  it("installs one watcher in StrictMode and cleans up on unmount",async()=>{
    const {unmount}=renderHook(()=>useJourneyTracking("trip",true,vi.fn()),{wrapper:StrictMode});await waitFor(()=>expect(watchPosition).toHaveBeenCalledOnce());
    unmount();expect(clearWatch).toHaveBeenCalledOnce();await act(async()=>{position(sample());await Promise.resolve();});expect(send).not.toHaveBeenCalled();
  });
  it("does not request permission for a page opened in the background",async()=>{
    Object.defineProperty(document,"hidden",{configurable:true,value:true});renderHook(()=>useJourneyTracking("trip",true,vi.fn()));await act(async()=>{});expect(watchPosition).not.toHaveBeenCalled();
    Object.defineProperty(document,"hidden",{configurable:true,value:false});act(()=>{document.dispatchEvent(new Event("visibilitychange"));});expect(watchPosition).toHaveBeenCalledOnce();
  });
  it("does not show sharing when the upload fails, and allows retry",async()=>{
    send.mockRejectedValueOnce(new Error("Network unavailable"));const {result}=renderHook(()=>useJourneyTracking("trip",true,vi.fn()));await waitFor(()=>expect(watchPosition).toHaveBeenCalledOnce());
    await act(async()=>{position(sample());await Promise.resolve();});expect(result.current.status).toBe("unavailable");expect(result.current.message).toBe("Network unavailable");
    await act(()=>result.current.start());await act(async()=>{position(sample());await Promise.resolve();});expect(result.current.status).toBe("sharing");
  });
});
