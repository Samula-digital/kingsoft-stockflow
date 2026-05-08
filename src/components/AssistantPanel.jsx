import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAssistantComposerHint,
  buildAssistantQuickLabel,
  buildAssistantStarterPrompts,
  buildAssistantWelcome,
  getAssistantReply,
} from "../utils/assistant";

const workspaceLabels = {
  dashboard: "Control Room",
  entry: "Store Desk",
  stock: "Item Ledger",
  finance: "Finance Pack",
  department: "Department Use",
  history: "Audit Trail",
  admin: "Setup",
};

function createMessage(role, text, actions = []) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    text,
    actions,
  };
}

export default function AssistantPanel({ context, onRunAction }) {
  const starterPrompts = useMemo(
    () => buildAssistantStarterPrompts(context),
    [context]
  );
  const composerHint = useMemo(() => buildAssistantComposerHint(context), [context]);
  const quickLabel = useMemo(() => buildAssistantQuickLabel(context), [context]);
  const [isOpen, setIsOpen] = useState(false);
  const [showPrompts, setShowPrompts] = useState(true);
  const [draft, setDraft] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [messages, setMessages] = useState(() => [
    createMessage("assistant", buildAssistantWelcome(context)),
  ]);
  const messageListRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const messageList = messageListRef.current;
    if (!messageList) return;

    messageList.scrollTop = messageList.scrollHeight;
  }, [isOpen, messages]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    setMessages((currentMessages) => {
      if (
        currentMessages.length === 1 &&
        currentMessages[0]?.role === "assistant"
      ) {
        return [createMessage("assistant", buildAssistantWelcome(context))];
      }

      return currentMessages;
    });
  }, [context]);

  async function submitPrompt(promptText) {
    const trimmedPrompt = String(promptText ?? "").trim();
    if (!trimmedPrompt) return;
    setIsWorking(true);

    try {
      const reply = getAssistantReply(trimmedPrompt, context);
      let autoRunResult = reply.autoRunAction
        ? await onRunAction?.(reply.autoRunAction)
        : "";

      setMessages((currentMessages) => {
        const nextMessages = [
          ...currentMessages,
          createMessage("user", trimmedPrompt),
          createMessage("assistant", reply.text, reply.actions),
        ];

        if (autoRunResult) {
          nextMessages.push(createMessage("assistant", autoRunResult));
        }

        return nextMessages;
      });
      setDraft("");
      setIsOpen(true);
      setShowPrompts(false);
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage("user", trimmedPrompt),
        createMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "I hit a problem while working on that, but you can try again."
        ),
      ]);
    } finally {
      setIsWorking(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    void submitPrompt(draft);
  }

  async function handleActionClick(action) {
    setIsWorking(true);

    try {
      const result = await onRunAction?.(action);

      if (result) {
        setMessages((currentMessages) => [
          ...currentMessages,
          createMessage("assistant", result),
        ]);
      }
    } catch (error) {
      setMessages((currentMessages) => [
        ...currentMessages,
        createMessage(
          "assistant",
          error instanceof Error
            ? error.message
            : "I could not complete that action right now."
        ),
      ]);
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <>
      <button
        className="assistant-fab"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        type="button"
      >
        {isOpen ? "Close" : "Assistant"}
      </button>

      {isOpen ? (
        <aside className="assistant-panel" aria-label="AI assistant">
          <div className="assistant-panel-header">
            <div>
              <div className="section-kicker">AI Assistant</div>
              <h2>Ask</h2>
              <p>Tell me what you need. I can guide, open screens, or prepare work.</p>
              <div className="assistant-context-chip">Focused on {workspaceLabels[context.activeTab] || "this workspace"}</div>
            </div>
            <button
              className="button button-secondary button-small"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="assistant-message-list" ref={messageListRef}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`assistant-message assistant-message-${message.role}`}
              >
                <strong>{message.role === "assistant" ? "Assistant" : "You"}</strong>
                <p>{message.text}</p>

                {message.actions?.length ? (
                  <div className="toolbar">
                    {message.actions.map((action) => (
                      <button
                        key={`${message.id}-${action.type}-${action.label}`}
                        className="button button-secondary button-small"
                        disabled={isWorking}
                        onClick={() => void handleActionClick(action)}
                        type="button"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="assistant-quick-section">
            <div className="assistant-quick-header">
              <strong>{quickLabel}</strong>
              <button
                className="button button-secondary button-small"
                onClick={() => setShowPrompts((currentValue) => !currentValue)}
                type="button"
              >
                {showPrompts ? "Hide" : "Show"}
              </button>
            </div>

            {showPrompts ? (
              <div className="assistant-prompt-row">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="pill-button"
                    onClick={() => void submitPrompt(prompt)}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <form className="assistant-form" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              className="input"
              placeholder={composerHint}
              value={draft}
              disabled={isWorking}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button className="button" type="submit" disabled={isWorking}>
              {isWorking ? "Working..." : "Ask"}
            </button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
