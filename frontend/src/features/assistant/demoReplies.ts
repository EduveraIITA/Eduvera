export type AssistantPortal = "principal" | "teacher" | "parent" | "student";
export interface AssistantContext {
  portal: AssistantPortal;
  pageTitle: string;
  studentId?: string;
  permissions?: readonly string[];
}
export interface DemoReply { text: string; link?: { label: string; to: string } }

// Deliberately local and deterministic. No model, record retrieval or mutations.
export function demoReply(question: string, context: AssistantContext): DemoReply {
  const { portal, permissions, studentId } = context;
  const topics = [
    { match: /attend|register|absen|present/i, title: "attendance", permission: "attendance.view", path: "attendance", text: "Open Attendance to see recorded attendance and anything still waiting to be marked." },
    { match: /timetable|schedule|lesson|next class/i, title: "timetable", permission: "timetable.view", path: "timetable", text: "Your timetable has the published schedule. Choose a date to see that day's classes." },
    { match: /bus|transport|ride|pickup|pick.up|drop.off|journey/i, title: "transport", permission: "departure.collect", path: portal === "teacher" ? "transport" : "departure", text: "Open Transport to check your available rides, stops and journey status. Location is available only when the journey allows it." },
    { match: /homework|diary|assignment/i, title: portal === "teacher" ? "my classes" : "diary", permission: "attendance.view", path: portal === "teacher" ? "classes" : "diary", text: "Open the class or diary to review homework and notes. This demo cannot read or submit them for you." },
    { match: /result|mark|assessment|exam|grade/i, title: "results", permission: "assessments.view", path: ["principal", "teacher"].includes(portal) ? "assessments" : "results", text: "Open your assessment results to review the records available to your account." },
    { match: /message|contact|conversation/i, title: "messages", permission: "messages.view", path: "messages", text: "Messages is for conversations with people at school. This Chat is a demo assistant and does not send messages." },
    { match: /insight|analytic|trend|overview/i, title: "insights", permission: "attendance.view", path: "insights", text: "Insights brings together trends and lets you open the underlying details. This demo has not analysed your records." },
  ];
  const topic = topics.find(item => item.match.test(question));
  const more = portal === "student" ? "apps" : "more";
  const canLink = topic && !(portal === "principal" && topic.path === "diary") && !(portal === "teacher" && permissions && !permissions.includes(topic.permission));
  const path = canLink ? topic.path : more;
  const to = `/${portal}/${path}${portal === "parent" && studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`;
  const writeRequest = /\b(mark|send|approve|cancel|submit|delete|publish|change|book|pay)\b/i.test(question);
  if (writeRequest) return { text: "I can't change records or send anything in this demo. You can open the relevant screen and review the action yourself.", link: { label: canLink ? `Open ${topic.title}` : "Open More", to } };
  if (canLink) return { text: topic.text, link: { label: `Open ${topic.title}`, to } };
  return { text: topic ? "I can't access those records in this demo. More shows the tools available to your account." : "I'm a demo assistant, not a connected AI yet. Try asking about attendance, a timetable, results or transport, and I'll point you to the right screen.", link: { label: "Open More", to } };
}
