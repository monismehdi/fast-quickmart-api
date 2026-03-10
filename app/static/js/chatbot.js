(() => {
  const WIDGET_ID = "quickmart-chatbot";
  const OPEN_LABEL = "Need help?";
  const INITIAL_MESSAGE =
    "Hi! I'm Quickmart's assistant. Ask me about order status, refunds, cancellation, or any between questions.";
  const INITIAL_SUGGESTIONS = ["Track order", "Refund policy", "Talk to human"];

  const buildMarkup = () => `
    <button type="button" class="chat-trigger" aria-label="Open Quickmart assistant">
      <span class="chat-trigger-icon">💬</span>
      <span class="chat-trigger-label">${OPEN_LABEL}</span>
    </button>
    <div class="chat-panel" aria-live="polite">
      <header>
        <div>
          <strong>Quickmart Assistant</strong>
          <p>Instant replies on order status, cancellations, and more.</p>
        </div>
        <button type="button" class="chat-close" aria-label="Close assistant">×</button>
      </header>
      <div class="chat-log" role="log" aria-live="polite" aria-label="Conversation"></div>
      <div class="chat-suggestions" aria-label="Suggested questions"></div>
      <form class="chat-form">
        <input type="text" name="message" autocomplete="off" placeholder="Ask about your order, refund, or support…" required />
        <button type="submit">Send</button>
      </form>
      <div class="chat-footnote"></div>
    </div>
  `;

  const appendMessage = (log, text, source) => {
    const wrapper = document.createElement("div");
    wrapper.className = `chat-message ${source}`;
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${source}`;
    bubble.textContent = text;
    wrapper.append(bubble);
    log.append(wrapper);
    log.scrollTop = log.scrollHeight;
  };

  const updateSuggestions = (container, suggestions, onSelect) => {
    container.innerHTML = "";
    if (!suggestions || !suggestions.length) {
      container.classList.add("hidden");
      return;
    }
    container.classList.remove("hidden");
    suggestions.forEach((text) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chat-chip";
      chip.textContent = text;
      chip.addEventListener("click", () => onSelect(text));
      container.append(chip);
    });
  };

  const updateFootnote = (footnote, data) => {
    if (data?.human && data?.contact) {
      const { email, phone } = data.contact;
      const contactParts = [];
      if (email) {
        contactParts.push(`<a href="mailto:${email}">${email}</a>`);
      }
      if (phone) {
        contactParts.push(`<a href="tel:${phone}">${phone}</a>`);
      }
      footnote.innerHTML = `Need extra help? ${contactParts.join(" or ")}.`;
      return;
    }
    footnote.textContent = "Answers are served by Quickmart's knowledge base.";
  };

  const sendMessage = async (input, log, suggestionsEl, footnote, container, text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    appendMessage(log, trimmed, "user");
    input.value = "";
    updateSuggestions(suggestionsEl, [], () => {});
    input.disabled = true;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Unable to reach the assistant");
      }
      appendMessage(log, payload.reply, "bot");
      updateSuggestions(suggestionsEl, payload.suggestions || [], (value) => {
        sendMessage(input, log, suggestionsEl, footnote, container, value);
        container.classList.add("open");
      });
      updateFootnote(footnote, payload);
    } catch (error) {
      appendMessage(log, `Oops, something went wrong. ${error.message || ""}`.trim(), "bot");
      footnote.textContent = "Try again in a few seconds or tap 'Talk to human'.";
    } finally {
      input.disabled = false;
      input.focus();
      container.classList.add("open");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById(WIDGET_ID)) {
      return;
    }
    const root = document.createElement("div");
    root.id = WIDGET_ID;
    root.className = "chat-widget";
    root.innerHTML = buildMarkup();
    document.body.append(root);

    const trigger = root.querySelector(".chat-trigger");
    const closeBtn = root.querySelector(".chat-close");
    const log = root.querySelector(".chat-log");
    const suggestions = root.querySelector(".chat-suggestions");
    const form = root.querySelector(".chat-form");
    const input = form.querySelector("input");
    const footnote = root.querySelector(".chat-footnote");

    const appendActionTable = (actions) => {
      const existing = log.querySelector(".chat-table");
      if (existing) {
        existing.remove();
      }
      if (!actions || !actions.length) {
        return;
      }
      const table = document.createElement("div");
      table.className = "chat-table";
      actions.forEach(({ label, value }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", () => {
          sendMessage(input, log, suggestions, footnote, root, value || label);
        });
        table.append(button);
      });
      log.append(table);
      log.scrollTop = log.scrollHeight;
    };

    const showActionTable = (actions, prompt = "Share a note with the delivery agent:") => {
      if (!actions || !actions.length) {
        return;
      }
      root.classList.add("open");
      appendMessage(log, prompt, "bot");
      appendActionTable(actions);
      input.focus();
    };

    window.quickmartAssistant = {
      showActionTable,
      open: () => root.classList.add("open"),
    };

    trigger.addEventListener("click", () => root.classList.toggle("open"));
    closeBtn.addEventListener("click", () => root.classList.remove("open"));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage(input, log, suggestions, footnote, root, input.value);
    });

    appendMessage(log, INITIAL_MESSAGE, "bot");
    updateSuggestions(suggestions, INITIAL_SUGGESTIONS, (value) => {
      sendMessage(input, log, suggestions, footnote, root, value);
      root.classList.add("open");
    });
    updateFootnote(footnote, {});
  });
})();
