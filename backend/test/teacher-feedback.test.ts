import { describe, expect, it } from 'vitest';
import { campaignInput, feedbackReleasePolicy, responseInput, summarizeRatings, validRatingKeys, type Ratings } from '../src/teacher-feedback/feedback-rules.js';
const id='123e4567-e89b-42d3-a456-426614174000';
const request={teacher_user_id:id,class_section_id:id,title:'Teaching check-in',audience:'students',closes_at:'2026-12-01T10:00:00Z',parameters:['Punctuality','Teaching clarity']};
describe('teacher feedback contract and privacy',()=>{
  it('limits the one-response preview to seeded demo administrators at Cambridge',()=>{
    const demo={username:'meera.principal',email:'meera.kapoor@example.test'};
    expect(feedbackReleasePolicy(true,demo,'cis')).toEqual({demo_preview:true,minimum_responses:1});
    for(const policy of [feedbackReleasePolicy(false,demo,'cis'),feedbackReleasePolicy(true,demo,'other'),feedbackReleasePolicy(true,{...demo,email:'real@example.test'},'cis'),feedbackReleasePolicy(true,{...demo,username:'real.admin'},'cis')])expect(policy).toEqual({demo_preview:false,minimum_responses:5});
    expect(summarizeRatings(['Clarity'],[{Clarity:'high'}],1)[0]).toMatchObject({counts:{high:1},signal:'strength'});
    expect(summarizeRatings(['Clarity'],[{Clarity:'high'}])[0]).toMatchObject({counts:null});
    expect(summarizeRatings(['Clarity'],[{Clarity:'na'}],1)[0]).toMatchObject({counts:null});
  });
  it('accepts bounded configurable parameters and rejects duplicates',()=>{
    expect(campaignInput.safeParse(request).success).toBe(true);
    for(const parameters of [[],['Punctuality','punctuality'],Array.from({length:11},(_,i)=>`Parameter ${i}`)])expect(campaignInput.safeParse({...request,parameters}).success).toBe(false);
  });
  it('requires exact campaign parameters and a supported rating',()=>{
    expect(validRatingKeys(request.parameters,{'Punctuality':'low','Teaching clarity':'na'})).toBe(true);
    expect(validRatingKeys(request.parameters,{'Punctuality':'high'})).toBe(false);
    expect(validRatingKeys(request.parameters,{'Punctuality':'high','Other':'okay'})).toBe(false);
    expect(responseInput.safeParse({ratings:{Punctuality:5}}).success).toBe(false);
  });
  it('suppresses small samples even with many Not sure responses',()=>{
    const rows:Ratings[]=Array.from({length:10},(_,i)=>({'Punctuality':i<4?'low':'na'}));
    expect(summarizeRatings(['Punctuality'],rows)[0]).toMatchObject({rated:4,counts:null,signal:'insufficient'});
  });
  it('counts Low/Okay/High separately, excludes Not sure and labels review signals',()=>{
    const rows:Ratings[]=['low','low','okay','high','high','na'].map(r=>({'Punctuality':r as Ratings[string]}));
    expect(summarizeRatings(['Punctuality'],rows)[0]).toEqual({parameter:'Punctuality',rated:5,counts:{low:2,okay:1,high:2,na:1},signal:'review'});
    expect(summarizeRatings(['Punctuality'],Array.from({length:5},()=>({'Punctuality':'high' as const})))[0]?.signal).toBe('strength');
  });
});
