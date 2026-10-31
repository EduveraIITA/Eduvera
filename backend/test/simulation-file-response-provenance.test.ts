import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { AssessmentsController } from "../src/assessments/assessments.controller.js";
import { ChatController } from "../src/chat/chat.controller.js";
import type { AuthenticatedRequest } from "../src/common/request.js";
import { GateController } from "../src/gate/gate.controller.js";
import { SchoolController } from "../src/school/school.controller.js";

const request = { authUser: { id: "user-1" } } as unknown as AuthenticatedRequest;

function response() {
  const reply: Record<string, ReturnType<typeof vi.fn>> = {};
  reply.type = vi.fn(() => reply);
  reply.header = vi.fn(() => reply);
  reply.send = vi.fn((value) => value);
  return reply;
}

function expectSimulationProvenance(reply: ReturnType<typeof response>) {
  expect(reply.header).toHaveBeenCalledWith("X-ThatCampus-Evidence-Mode", "simulation");
  expect(reply.header).toHaveBeenCalledWith("X-ThatCampus-Source-Content-Omitted", "true");
}

describe("Simulation file response provenance", () => {
  it("marks chat, leave, assessment and gate placeholders as Simulation evidence", async () => {
    const stream = Readable.from([Buffer.from("placeholder")]);

    const chatReply = response();
    const chat = new ChatController({
      attachment: vi.fn().mockResolvedValue({
        attachment: { original_name: "simulation-source-placeholder.txt", content_type: "text/plain" },
        stream,
        evidence_mode: "simulation",
        source_content_omitted: true,
      }),
    } as never);
    await chat.attachment(request, chatReply as never, "conversation-1", "message-1");
    expectSimulationProvenance(chatReply);

    const schoolReply = response();
    const school = new SchoolController({
      leaveDocument: vi.fn().mockResolvedValue({
        document: { original_name: "simulation-source-placeholder.pdf", content_type: "application/pdf" },
        stream,
        evidence_mode: "simulation",
        source_content_omitted: true,
      }),
    } as never, {} as never);
    await school.downloadDocument(request, schoolReply as never, "leave-1", "document-1");
    expectSimulationProvenance(schoolReply);

    const assessmentReply = response();
    const assessments = new AssessmentsController({
      evidence: vi.fn().mockResolvedValue({
        record: { original_name: "simulation-source-placeholder.pdf", content_type: "application/pdf" },
        stream,
        evidence_mode: "simulation",
        source_content_omitted: true,
      }),
    } as never, {} as never);
    await assessments.evidence(request, assessmentReply as never, "school-1", "assessment-1", "evidence-1");
    expectSimulationProvenance(assessmentReply);

    const gateReply = response();
    const gate = new GateController({
      visitorPhoto: vi.fn().mockResolvedValue({
        type: "image/svg+xml",
        stream,
        evidence_mode: "simulation",
        source_content_omitted: true,
      }),
    } as never);
    await gate.photo(request, gateReply as never, "school-1", "visitor-1");
    expectSimulationProvenance(gateReply);
  });
});
