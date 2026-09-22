import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma";
import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  validateUIMessages,
  type UIMessage,
} from "ai";

export const maxDuration = 60;

const SYSTEM_INSTRUCTIONS = `You are the GMD quotation assistant, an internal helper for the valve quotation workflow at GMD (Dalui). You help with quotations, BOM, contract review, supply history, and BIS status. Be concise, precise, and dense — the user is a busy operator. Use markdown tables for tabular data. Answer in plain language. If you do not know something, say so clearly.`;

async function requireUser() {
  const session = await auth();
  const userId = (session?.user as any)?.id as string | undefined;
  return userId ?? null;
}

export async function POST(req: Request) {
  const userId = await requireUser();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, message }: { id: string; message: UIMessage } = await req.json();
  if (!id || !message) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  let chat = await prisma.chatSession.findUnique({ where: { id } });
  if (!chat) {
    chat = await prisma.chatSession.create({
      data: { id, userId, messages: [] },
    });
  } else if (chat.userId !== userId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const previous = (chat.messages as unknown as UIMessage[]) ?? [];
  const messages = [...previous, message];
  const validated = await validateUIMessages({ messages });

  const result = streamText({
    model: openai("gpt-4o-mini"),
    instructions: SYSTEM_INSTRUCTIONS,
    messages: await convertToModelMessages(validated),
  });

  result.consumeStream();

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: messages,
      onEnd: async ({ messages: finalMessages }) => {
        const firstUser = finalMessages.find((m) => m.role === "user");
        const firstText = firstUser?.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("")
          .slice(0, 60);
        await prisma.chatSession.update({
          where: { id },
          data: {
            messages: finalMessages as unknown as Prisma.InputJsonValue,
            ...(chat.title === "New chat" && firstText
              ? { title: firstText }
              : {}),
          },
        });
      },
    }),
  });
}

export async function GET(req: Request) {
  const userId = await requireUser();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const chat = await prisma.chatSession.findFirst({
      where: { id, userId },
    });
    return Response.json({
      id: chat?.id ?? null,
      messages: chat?.messages ?? [],
    });
  }

  const chat = await prisma.chatSession.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return Response.json({
    id: chat?.id ?? null,
    messages: chat?.messages ?? [],
  });
}

export async function DELETE(req: Request) {
  const userId = await requireUser();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  await prisma.chatSession.deleteMany({ where: { id, userId } });
  return Response.json({ ok: true });
}