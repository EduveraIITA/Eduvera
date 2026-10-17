import assert from "node:assert/strict";
import test from "node:test";
import { ApiSession } from "../src/http-session.mjs";

test("logs an exact fixture actor in through the ordinary CSRF-protected application flow",async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith("/api/v1/auth/csrf/")) return new Response(JSON.stringify({csrf_token:"csrf-one"}),{
      status:200,headers:{"content-type":"application/json","set-cookie":"csrftoken=csrf-one; Path=/"},
    });
    assert.equal(options.headers.get("x-csrftoken"),"csrf-one");
    assert.deepEqual(JSON.parse(options.body),{identifier:"manish.tiwari",password:"fixture-secret"});
    return new Response(JSON.stringify({user:{id:"staff-1",active_school_id:"school-1"},csrf_token:"csrf-two"}),{
      status:200,headers:{"content-type":"application/json","set-cookie":"csrftoken=csrf-two; Path=/"},
    });
  };
  const session=new ApiSession("http://127.0.0.1:8001",{fetchImpl});

  await session.login("manish.tiwari","fixture-secret");

  assert.equal(calls.length,2);
  assert.equal(calls[1].options.method,"POST");
  assert.equal(session.csrfToken,"csrf-two");
  assert.equal(session.user.id,"staff-1");
});
