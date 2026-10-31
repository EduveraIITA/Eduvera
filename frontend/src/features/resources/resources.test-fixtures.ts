import type { ResourceItem, ResourceItemCreation, ResourceLoanDetail, ResourceOptions, ResourcesPage } from "./resourceApi";

/** Fictional records used only by the focused component tests. Never a runtime fallback. */
export function resourceFixtureLoan(overrides:Partial<ResourceLoanDetail>={}):ResourceLoanDetail {
  return {id:"loan-1",title:"Project camera",asset_tag:"CAM-01",borrower:{id:"person-1",label:"Sana Patel"},custodian:{id:"person-2",label:"Dev Shah"},issued_at:"2026-10-20T10:00:00Z",due_at:"2026-10-23T10:00:00Z",revision:1,state:"overdue",outstanding_count:2,question_count:0,
    parts:[{id:"part-camera",label:"Camera",quantity:1,returned_quantity:0,outstanding_quantity:1,condition:"usable"},{id:"part-charger",label:"Charger",quantity:1,returned_quantity:0,outstanding_quantity:1,condition:"usable"}],history:[],history_has_more:false,questions:[],can_record_return:true,can_change_due:true,can_question:false,can_reply:true,can_resolve:true,can_change_custodian:false,custody_recovery:false,...overrides};
}
export function resourceFixtureItem(overrides:Partial<ResourceItem>={}):ResourceItem {
  return {id:"item-1",name:"Project camera",asset_tag:"CAM-01",campus_id:"campus-1",campus_name:"Riverview",revision:1,tracking_mode:"individual",state:"available",available:true,unavailable_reason:null,active_loan_id:null,...overrides};
}
export function resourceFixtureItemCreation(commandId:string,quantity=1,overrides:Partial<ResourceItem>={}):ResourceItemCreation {
  const created_items=Array.from({length:quantity},(_,index)=>resourceFixtureItem({...overrides,id:index===0 ? commandId : `${commandId}:copy-${index+1}`}));
  return {...created_items[0]!,quantity,created_items};
}
export function resourceFixtureOptions(overrides:Partial<ResourceOptions>={}):ResourceOptions {
  return {campuses:[{id:"campus-1",name:"Riverview"}],people:[],holdings:[resourceFixtureItem()],actor:{person_id:"person-2",label:"Dev Shah"},can_manage:true,can_add_people:true,pagination:{page:1,page_size:25,people_total:0,holdings_total:1},...overrides};
}
export function resourceFixturePage(overrides:Partial<ResourcesPage>={}):ResourcesPage {
  return {view:"loans",can_manage:true,can_issue:true,loans:[resourceFixtureLoan()],items:[],totals:{outstanding:1,overdue:1,questions:0},pagination:{page:1,page_size:10,total:1},...overrides};
}
