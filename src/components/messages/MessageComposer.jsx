import {forwardRef, useImperativeHandle, useLayoutEffect, useRef} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {chatApi} from "@/features/collab/collabApi";
import {customEmojiToken, readComposerText, splitInlineEmojis} from "@/features/collab/inlineEmojis";
import {getCurrentUserNamespace} from "@/lib/userScopedStorage";
import {retryEmojiQuery} from "@/features/collab/customEmojis";

const MessageComposer = forwardRef(function MessageComposer({value, onChange, onPaste, onKeyDown, maxLength, ...props}, ref) {
  const editor = useRef(null);
  const selection = useRef(null);
  const queryClient = useQueryClient();
  const currentValue = useRef(value);
  currentValue.current = value;

  function saveSelection() {
    const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    if (range && editor.current.contains(range.commonAncestorContainer)) selection.current = range.cloneRange();
  }
  function loadImage(span, part) {
    if (!span.isConnected) return;
    const owner = getCurrentUserNamespace();
    void queryClient.fetchQuery({
      queryKey: ["custom-emoji-image", owner, part.id],
      queryFn: () => chatApi.getEmoji(part.id), staleTime: Infinity, retry: retryEmojiQuery
    }).then(data => {
      if (!span.isConnected || owner !== getCurrentUserNamespace()) return;
      const image = document.createElement("img");
      image.src = data;
      image.alt = `:${part.name}:`;
      image.width = image.height = 24;
      image.className = "inline-block align-middle object-contain";
      span.replaceChildren(image);
    }).catch(error => {
      if (!span.isConnected || owner !== getCurrentUserNamespace()) return;
      span.textContent = `:${part.name}: unavailable`;
      span.setAttribute("role", "alert");
      span.title = error.message;
    });
  }
  function nodes(text) {
    return splitInlineEmojis(text).flatMap(part => {
      if (!part.id) return part.text.split("\n").flatMap((line, index) =>
        index ? [document.createElement("br"), document.createTextNode(line)] : [document.createTextNode(line)]);
      const span = document.createElement("span");
      span.contentEditable = "false";
      span.dataset.emojiToken = part.token;
      span.textContent = `:${part.name}:`;
      span.title = `:${part.name}:`;
      span.className = "inline-block align-middle";
      // Defer loading until the node has been attached to the editor.
      queueMicrotask(() => loadImage(span, part));
      return span;
    });
  }
  function replaceValue(text) {
    editor.current.replaceChildren(...nodes(text));
    selection.current = null;
  }
  function publish() {
    const text = readComposerText(editor.current);
    if (text.length > maxLength) {
      toast.error(`Messages can be up to ${maxLength} characters.`);
      replaceValue(currentValue.current);
      return;
    }
    currentValue.current = text;
    onChange(text);
    saveSelection();
  }
  function insert(text) {
    const root = editor.current;
    root.focus({preventScroll: true});
    const range = selection.current && root.contains(selection.current.commonAncestorContainer)
      ? selection.current : document.createRange();
    if (!selection.current || !root.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(root);
      range.collapse(false);
    }
    const selected = document.createElement("div");
    selected.append(range.cloneContents());
    if (readComposerText(root).length - readComposerText(selected).length + text.length > maxLength) {
      toast.error(`Messages can be up to ${maxLength} characters.`);
      return;
    }
    const caret = window.getSelection();
    caret.removeAllRanges();
    caret.addRange(range);
    const markup = document.createElement("div");
    markup.append(...nodes(text));
    // Chromium's editing command keeps emoji insertion in the native undo stack.
    const inserted = text === "\n"
      ? document.execCommand("insertLineBreak")
      : document.execCommand("insertHTML", false, markup.innerHTML);
    if (!inserted) {
      toast.error("Could not insert into the message. Click in the message box and try again.");
      return;
    }
    for (const span of root.querySelectorAll("[data-emoji-token]")) {
      if (!span.querySelector("img")) loadImage(span, splitInlineEmojis(span.dataset.emojiToken)[0]);
    }
    publish();
  }
  function copySelection(event, cut) {
    const range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null;
    if (!range || range.collapsed || !editor.current.contains(range.commonAncestorContainer)) return;
    const selected = document.createElement("div");
    selected.append(range.cloneContents());
    event.clipboardData.setData("text/plain", readComposerText(selected));
    event.preventDefault();
    if (cut) {
      if (!document.execCommand("delete")) toast.error("Could not cut the selected message text.");
      publish();
    }
  }
  useImperativeHandle(ref, () => ({
    focus: options => editor.current.focus(options),
    insertEmoji: (emoji, type) => insert(type === "custom_emoji" ? customEmojiToken(emoji) : emoji.emoji)
  }));
  useLayoutEffect(() => {
    if (readComposerText(editor.current) !== value) replaceValue(value);
  }, [value]);

  return <div {...props} ref={editor} role="textbox" aria-multiline="true"
    contentEditable suppressContentEditableWarning
    data-empty={!value}
    className="min-h-10 max-h-[120px] w-full overflow-y-auto whitespace-pre-wrap break-words px-3 py-2 text-sm outline-none data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-muted-foreground data-[empty=true]:before:content-['Type_a_message']"
    onInput={publish} onKeyUp={saveSelection} onMouseUp={saveSelection} onBlur={saveSelection}
    onCopy={event => copySelection(event, false)} onCut={event => copySelection(event, true)}
    onKeyDown={event => {
      onKeyDown(event);
      if (!event.defaultPrevented && event.key === "Enter" && event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        saveSelection();
        insert("\n");
      }
    }}
    onPaste={event => {
      onPaste(event);
      if (event.defaultPrevented) return;
      event.preventDefault();
      insert(event.clipboardData.getData("text/plain"));
    }}
    onDrop={event => {event.preventDefault(); toast.error("Paste screenshots or use the attachment controls instead of dropping files.");}}
  />;
});

export default MessageComposer;
