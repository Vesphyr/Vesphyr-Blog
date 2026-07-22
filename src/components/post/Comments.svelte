<script lang="ts">
  import { onMount } from "svelte";

  interface Comment {
    id: number;
    authorName: string;
    authorUrl: string;
    content: string;
    createdAt: number;
  }

  export let postSlug = "";
  export let postTitle = "";
  export let postUrl = "";

  let comments: Comment[] = [];
  let total = 0;
  let offset = 0;
  let hasMore = false;
  let loading = false;
  let submitting = false;
  let status = "";
  let statusType = "info";

  let name = "";
  let website = "";
  let message = "";
  let honeypot = "";

  let isAdminMode = false;
  const ADMIN_TOKEN_KEY = "guestbook:admin-token";
  const DRAFT_PREFIX = "comment:draft:";

  $: charCount = message.length;
  $: commentsCount = total;

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_PREFIX + postSlug);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (typeof draft.name === "string") name = draft.name;
      if (typeof draft.website === "string") website = draft.website;
      if (typeof draft.message === "string") message = draft.message;
    } catch {}
  }

  function saveDraft() {
    try {
      localStorage.setItem(
        DRAFT_PREFIX + postSlug,
        JSON.stringify({ name, website, message }),
      );
    } catch {}
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_PREFIX + postSlug);
    } catch {}
  }

  function getAdminToken(): string | null {
    try {
      return sessionStorage.getItem(ADMIN_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function formatRelative(ts: number): string {
    const now = Date.now();
    const diff = now - ts * 1000;
    if (diff < 60_000) return "刚刚";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
    return formatDate(ts);
  }

  function formatDate(ts: number): string {
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(ts * 1000));
    } catch {
      return "";
    }
  }

  function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash >>> 0;
  }

  function avatarHue(name: string): number {
    return hashString(name) % 360;
  }

  function avatarLetter(name: string): string {
    const trimmed = name.trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  function linkifyContent(text: string): string {
    const escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return escaped.replace(
      /(https?:\/\/[^\s<>"']+)/gi,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="comment-inline-link">$1</a>',
    );
  }

  function setStatus(msg: string, type = "info") {
    status = msg;
    statusType = type;
  }

  async function loadComments(reset = true) {
    if (reset) {
      offset = 0;
      loading = true;
    }
    setStatus("");
    try {
      const res = await fetch(
        `/api/comments?post_slug=${encodeURIComponent(postSlug)}&limit=20&offset=${offset}`,
        { headers: { accept: "application/json" } },
      );
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "评论加载失败。");
      }
      const newComments: Comment[] = data.comments ?? [];
      if (reset) {
        comments = newComments;
      } else {
        comments = [...comments, ...newComments];
      }
      offset += newComments.length;
      hasMore = data.hasMore ?? false;
      total = data.total ?? 0;

      const token = getAdminToken();
      isAdminMode = !!token;
    } catch (error) {
      if (reset) comments = [];
      setStatus(error instanceof Error ? error.message : "评论加载失败。", "error");
    } finally {
      loading = false;
    }
  }

  async function handleSubmit() {
    if (!name.trim() || !message.trim()) {
      setStatus("请填写昵称和评论内容。", "error");
      return;
    }
    submitting = true;
    setStatus("正在发布...", "info");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          post_slug: postSlug,
          post_url: postUrl,
          post_title: postTitle,
          name: name.trim(),
          website: website.trim(),
          content: message.trim(),
          company: honeypot,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || "评论发布失败。");
      }
      message = "";
      clearDraft();
      setStatus("评论已发布。", "success");
      await loadComments(true);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "评论发布失败。", "error");
    } finally {
      submitting = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
    }
  }

  async function handleDelete(id: number) {
    const token = getAdminToken();
    if (!token) return;
    if (!confirm("确定删除这条评论吗？")) return;
    try {
      const res = await fetch(`/api/comments?id=${id}`, {
        method: "DELETE",
        headers: { "x-admin-token": token },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        if (res.status === 401) {
          try { sessionStorage.removeItem(ADMIN_TOKEN_KEY); } catch {}
          isAdminMode = false;
          await loadComments(true);
          setStatus("管理员 Token 已失效。", "error");
          return;
        }
        throw new Error(data.message || "删除失败。");
      }
      comments = comments.filter((c) => c.id !== id);
      total = Math.max(0, total - 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "删除失败。", "error");
    }
  }

  function onMessageInput() {
    saveDraft();
  }

  function onNameInput() {
    saveDraft();
  }

  function onWebsiteInput() {
    saveDraft();
  }

  onMount(() => {
    loadDraft();
    loadComments(true);
  });
</script>

<div class="comments-section">
  <div class="comments-header">
    <h3>
      评论
      {#if commentsCount > 0}
        <span class="comments-count">· {commentsCount}</span>
      {/if}
    </h3>
  </div>

  <form class="comments-form" on:submit|preventDefault={handleSubmit} autocomplete="on">
    <div class="comments-field-grid">
      <label>
        <span>昵称</span>
        <input
          type="text"
          bind:value={name}
          on:input={onNameInput}
          maxlength="32"
          required
          placeholder="你的名字"
        />
      </label>
      <label>
        <span>链接</span>
        <input
          type="url"
          bind:value={website}
          on:input={onWebsiteInput}
          maxlength="160"
          placeholder="https://example.com"
        />
      </label>
    </div>

    <label class="comments-message-field">
      <span>内容</span>
      <textarea
        bind:value={message}
        on:input={onMessageInput}
        on:keydown={handleKeydown}
        maxlength="1000"
        required
        rows="4"
        placeholder="写下你的评论... (Ctrl+Enter 发布)"
      ></textarea>
      <span class="comments-counter" class:near={charCount >= 900} aria-live="polite">
        {charCount}/1000
      </span>
    </label>

    <label class="comments-honeypot" aria-hidden="true">
      <span>请留空</span>
      <input type="text" tabindex="-1" bind:value={honeypot} />
    </label>

    <div class="comments-actions">
      <p class="comments-status" data-type={statusType} role="status">{status}</p>
      <button class="btn-regular" type="submit" disabled={submitting}>
        {submitting ? "发布中..." : "发布评论"}
      </button>
    </div>
  </form>

  <div class="comments-list" aria-live="polite">
    {#if loading}
      <div class="comments-empty">正在加载评论...</div>
    {:else if comments.length === 0}
      <div class="comments-empty">还没有评论，来说点什么吧。</div>
    {:else}
      {#each comments as comment (comment.id)}
        <article class="comment-item">
          <div class="comment-item-header">
            <div class="comment-item-left">
              <span
                class="comment-avatar"
                style="background-color: oklch(0.62 0.14 {avatarHue(comment.authorName)}deg)"
              >
                {avatarLetter(comment.authorName)}
              </span>
              {#if comment.authorUrl && /^https?:\/\//i.test(comment.authorUrl)}
                <a
                  class="comment-item-name"
                  href={comment.authorUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {comment.authorName}
                </a>
              {:else}
                <span class="comment-item-name">{comment.authorName}</span>
              {/if}
            </div>
            <time
              class="comment-item-time"
              datetime={new Date(comment.createdAt * 1000).toISOString()}
              title={formatDate(comment.createdAt)}
            >
              {formatRelative(comment.createdAt)}
            </time>
            {#if isAdminMode}
              <button
                class="comment-item-delete"
                on:click={() => handleDelete(comment.id)}
                aria-label="删除评论"
              >
                删除
              </button>
            {/if}
          </div>
          <p class="comment-item-content">{@html linkifyContent(comment.content)}</p>
        </article>
      {/each}
    {/if}
  </div>

  {#if hasMore}
    <button
      class="btn-plain comments-load-more"
      on:click={() => loadComments(false)}
      disabled={loading}
    >
      {loading ? "加载中..." : "加载更多"}
    </button>
  {/if}
</div>

<style>
  .comments-section {
    margin-top: 2rem;
    padding-top: 1.75rem;
    border-top: 1px solid var(--line-divider);
  }
  .comments-header {
    margin-bottom: 1.25rem;
  }
  .comments-header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1.25rem;
    font-weight: 800;
  }
  .comments-count {
    color: var(--text-tertiary);
    font-size: 1rem;
    font-weight: 500;
    margin-left: 0.25rem;
  }
  .comments-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.75rem;
  }
  .comments-field-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .comments-form label {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
    font-weight: 600;
  }
  .comments-form input,
  .comments-form textarea {
    width: 100%;
    border: 1px solid var(--line-divider);
    border-radius: 0.5rem;
    background: var(--btn-regular-bg);
    color: var(--text-primary);
    padding: 0.75rem 0.9rem;
    font: inherit;
    outline: none;
    transition: border-color 0.2s ease, background 0.2s ease;
  }
  .comments-form input:focus,
  .comments-form textarea:focus {
    border-color: var(--primary);
    background: var(--card-bg);
  }
  .comments-form textarea {
    resize: vertical;
    min-height: 6rem;
    line-height: 1.7;
  }
  .comments-counter {
    align-self: flex-end;
    margin-top: -0.25rem;
    color: var(--text-tertiary);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    transition: color 0.2s ease;
  }
  .comments-counter.near {
    color: #f59e0b;
  }
  .comments-honeypot {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
  .comments-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .comments-status {
    margin: 0;
    min-height: 1.5rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }
  .comments-status[data-type="error"] { color: #ef4444; }
  .comments-status[data-type="success"] { color: var(--primary); }
  .comments-actions button {
    min-height: 2.5rem;
    padding: 0 1rem;
    border-radius: 0.5rem;
    font-weight: 700;
  }
  .comments-actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .comments-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .comments-empty {
    border: 1px solid var(--line-divider);
    border-radius: 0.75rem;
    background: var(--btn-regular-bg);
    padding: 1rem;
    color: var(--text-secondary);
  }
  :global(.comment-item) {
    border: 1px solid var(--line-divider);
    border-radius: 0.75rem;
    background: var(--btn-regular-bg);
    padding: 1rem 1.1rem;
  }
  :global(.comment-item-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  :global(.comment-item-left) {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
  }
  :global(.comment-avatar) {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 0.8rem;
    font-weight: 700;
    text-transform: uppercase;
    user-select: none;
    line-height: 1;
  }
  :global(.comment-item-name) {
    color: var(--text-primary);
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-color: var(--primary);
    text-decoration-thickness: 0.1em;
    text-underline-offset: 0.2em;
    overflow-wrap: anywhere;
  }
  :global(a.comment-item-name:hover) { color: var(--primary); }
  :global(.comment-item-time) {
    color: var(--text-secondary);
    font-size: 0.85rem;
    white-space: nowrap;
    margin-left: auto;
  }
  :global(.comment-item-delete) {
    flex-shrink: 0;
    margin-left: 0.5rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--line-divider);
    border-radius: 0.4rem;
    background: transparent;
    color: var(--text-tertiary);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  :global(.comment-item-delete:hover) {
    border-color: #ef4444;
    color: #ef4444;
  }
  :global(.comment-item-content) {
    margin: 0.65rem 0 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  :global(.comment-inline-link) {
    color: var(--primary);
    text-decoration: underline;
    text-underline-offset: 0.15em;
    overflow-wrap: anywhere;
  }
  .comments-load-more {
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.9rem;
  }
  @media (max-width: 768px) {
    .comments-field-grid { grid-template-columns: 1fr; }
    .comments-actions {
      flex-direction: column;
      align-items: stretch;
    }
    :global(.comment-item-header) {
      flex-direction: column;
      align-items: flex-start;
    }
    :global(.comment-item-time) { margin-left: 0; }
  }
</style>
