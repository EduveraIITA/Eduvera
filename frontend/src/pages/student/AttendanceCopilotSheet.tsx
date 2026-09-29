import { useId, useState, type FormEvent } from "react";
import { Bot, RefreshCw, Send, Sparkles, X } from "lucide-react";

import "./student-pages.css";

export type AttendanceCopilotHandler = (question: string) => string | Promise<string>;

export interface AttendanceCopilotSheetProps {
  open: boolean;
  initialQuestion?: string;
  onClose: () => void;
  onAsk?: AttendanceCopilotHandler;
}

const promptSuggestions = [
  "How will 2 days of absence affect my eligibility?",
  "Which subject needs the most attendance?",
  "What documents make a medical absence excused?",
] as const;

export function AttendanceCopilotSheet({ open, initialQuestion = promptSuggestions[0], onClose, onAsk }: AttendanceCopilotSheetProps) {
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const headingId = useId();

  function closeSheet() {
    setQuestion(initialQuestion);
    setAnswer("");
    setErrorMessage("");
    setState("idle");
    onClose();
  }

  async function ask(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    if (!onAsk) {
      setErrorMessage("Attendance Copilot is not available for this account.");
      setState("error");
      return;
    }
    setState("loading");
    setAnswer("");
    setErrorMessage("");
    try {
      const suppliedAnswer = await onAsk(cleanQuestion);
      if (!suppliedAnswer.trim()) throw new Error("Attendance Copilot returned an empty response.");
      setAnswer(suppliedAnswer);
      setState("success");
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message.trim()
        ? error.message
        : "Copilot couldn't answer just now.");
      setState("error");
    }
  }

  if (!open) return null;

  return (
    <div className="student-sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeSheet()}>
      <section className="student-sheet copilot-sheet" role="dialog" aria-modal="true" aria-labelledby={headingId}>
        <div className="student-sheet__handle" />
        <header>
          <span className="copilot-sheet__mark"><Sparkles size={19} /></span>
          <div><h2 id={headingId}>Attendance Copilot</h2><p>Ask about eligibility, subject quotas, or excused absences.</p></div>
          <button type="button" className="student-icon-button" aria-label="Close Attendance Copilot" onClick={closeSheet}><X size={20} /></button>
        </header>
        <form onSubmit={ask}>
          <label className="copilot-input">
            <span>Your question</span>
            <textarea rows={3} maxLength={240} autoFocus value={question} onChange={(event) => setQuestion(event.target.value)} />
          </label>
          <div className="copilot-suggestions" aria-label="Suggested questions">
            {promptSuggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); setAnswer(""); setErrorMessage(""); setState("idle"); }}>{suggestion}</button>)}
          </div>
          {state === "success" && <div className="copilot-answer" role="status"><Bot size={20} /><span><strong>Based on your live attendance</strong><p>{answer}</p></span></div>}
          {state === "error" && <div className="copilot-error" role="alert"><strong>{errorMessage || "Copilot couldn't answer just now."}</strong>{onAsk && <button type="button" onClick={() => void ask()}><RefreshCw size={15} />Retry</button>}</div>}
          <button className="primary-action" type="submit" disabled={!question.trim() || state === "loading"}>
            {state === "loading" ? <><span className="button-spinner" />Checking attendance...</> : <><Send size={18} />{state === "success" ? "Ask another question" : "Ask Copilot"}</>}
          </button>
        </form>
      </section>
    </div>
  );
}
