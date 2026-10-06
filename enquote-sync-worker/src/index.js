import { handleWebhook } from "./webhook.js";
import { handleSnapshot } from "./snapshot.js";
import { handleSnapshotMeta } from "./snapshot-meta.js";
import { handleRealtimeSocket, QuoteSyncRoom } from "./realtime.js";
import { handleInboundBase44 } from "./inbound.js";
import { handleEntitySnapshot } from "./entity-snapshot.js";
import { handleAuthSession, handleSyncCredentials } from "./auth-session.js";
import { handlePresenceHeartbeat, handlePresenceList, handlePresenceRemove } from "./presence.js";
import { handleFstList, handleFstUpsert } from "./fsts.js";
import { handleUsers } from "./users.js";
import { handleTasksDelete, handleTasksList, handleTasksUpsert } from "./tasks.js";
import {
  handleSopFileDownload,
  handleSopFileUpload,
  handleSopsDelete,
  handleSopsList,
  handleSopsUpsert,
  handleSopsVersions
} from "./sops.js";
import {
  handleChatConversationCreate,
  handleChatConversations,
  handleChatConversationUpdate,
  handleChatDirectory,
  handleChatInbox,
  handleChatMessageSend,
  handleChatMessages,
  handleChatRead
} from "./chat.js";
import {
  handleProfileAvatarDownload,
  handleProfileAvatarRemove,
  handleProfileAvatarUpload,
  handleProfilesList
} from "./profiles.js";
import { handleGifsSearch, handleGifsTrending } from "./gifs.js";
import {handleRetro} from "./Base44_DTO.js";
import {
  handleAccessPolicy,
  handleAdminAnnouncement,
  handleAdminAudit,
  handleAdminChatRemoveMessage,
  handleAdminCommand,
  handleAdminOverview,
  handleAdminProfileResetAvatar,
  handleAdminRolePages,
  handleAdminSessions,
  handleAdminSessionsClear,
  handleAdminSopPurge,
  handleAdminUserOverride
} from "./admin.js";
import { handleUiBundle, handleUiManifest } from "./ui-updates.js";
import { handleErrorList, handleErrorReport } from "./errors.js";
import {
  handleSupervisorDelete,
  handleSupervisorIndex,
  handleSupervisorRecord,
  handleSupervisorUpsert
} from "./supervisor.js";
import { handleEnqueue } from "./outbound.js";
import { handleStatus } from "./status.js";
import { pushToBase44 } from "./pusher.js";
import { markOutboundStatus } from "./repository.js";
import { json } from "./util.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/Base44_DTO" && ["GET", "POST", "DELETE"].includes(request.method)) return handleRetro(request, env);
    if (url.pathname === "/ws" && request.method === "GET") return handleRealtimeSocket(request, env);
    if (url.pathname === "/api/base44/webhook" && request.method === "POST") return handleWebhook(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot" && request.method === "GET") return handleSnapshot(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot" && request.method === "GET") return handleSnapshot(request, env);
    if (url.pathname === "/api/base44/webhook/snapshot-meta" && request.method === "GET") return handleSnapshotMeta(request, env);
    if (url.pathname === "/api/outbound/enqueue" && request.method === "POST") return handleEnqueue(request, env);
    if (url.pathname === "/api/inbound/base44" && request.method === "POST") return handleInboundBase44(request, env);
    if (url.pathname === "/api/base44/webhook/entity-snapshot" && request.method === "GET") return handleEntitySnapshot(request, env);
    if (url.pathname === "/api/outbound/status" && request.method === "GET") return handleStatus(request, env);
    if (url.pathname === "/auth/session" && request.method === "GET") return handleAuthSession(request, env);
    if (url.pathname === "/auth/sync-credentials" && request.method === "GET") return handleSyncCredentials(request, env);
    if (url.pathname === "/api/presence/heartbeat" && request.method === "POST") return handlePresenceHeartbeat(request, env);
    if (url.pathname === "/api/presence" && request.method === "GET") return handlePresenceList(request, env);
    if (url.pathname === "/api/presence/remove" && request.method === "POST") return handlePresenceRemove(request, env);
    if (url.pathname === "/api/users" && request.method === "GET") return handleUsers(request, env);
    if (url.pathname === "/api/access/policy" && request.method === "GET") return handleAccessPolicy(request, env);
    if (url.pathname === "/api/admin/overview" && request.method === "GET") return handleAdminOverview(request, env);
    if (url.pathname === "/api/admin/user-override" && request.method === "POST") return handleAdminUserOverride(request, env);
    if (url.pathname === "/api/admin/role-pages" && request.method === "POST") return handleAdminRolePages(request, env);
    if (url.pathname === "/api/admin/announcement" && request.method === "POST") return handleAdminAnnouncement(request, env);
    if (url.pathname === "/api/admin/sessions" && request.method === "GET") return handleAdminSessions(request, env);
    if (url.pathname === "/api/admin/sessions/clear" && request.method === "POST") return handleAdminSessionsClear(request, env);
    if (url.pathname === "/api/admin/command" && request.method === "POST") return handleAdminCommand(request, env);
    if (url.pathname === "/api/admin/chat/remove-message" && request.method === "POST") return handleAdminChatRemoveMessage(request, env);
    if (url.pathname === "/api/admin/sops/purge" && request.method === "POST") return handleAdminSopPurge(request, env);
    if (url.pathname === "/api/admin/profiles/reset-avatar" && request.method === "POST") return handleAdminProfileResetAvatar(request, env);
    if (url.pathname === "/api/admin/audit" && request.method === "GET") return handleAdminAudit(request, env);
    if (url.pathname === "/api/tasks" && request.method === "GET") return handleTasksList(request, env);
    if (url.pathname === "/api/tasks/upsert" && request.method === "POST") return handleTasksUpsert(request, env);
    if (url.pathname === "/api/tasks/delete" && request.method === "POST") return handleTasksDelete(request, env);
    if (url.pathname === "/api/sops" && request.method === "GET") return handleSopsList(request, env);
    if (url.pathname === "/api/sops/upsert" && request.method === "POST") return handleSopsUpsert(request, env);
    if (url.pathname === "/api/sops/delete" && request.method === "POST") return handleSopsDelete(request, env);
    if (url.pathname === "/api/sops/versions" && request.method === "GET") return handleSopsVersions(request, env);
    if (url.pathname === "/api/sops/files" && request.method === "POST") return handleSopFileUpload(request, env);
    if (url.pathname.startsWith("/api/sops/files/") && request.method === "GET") {
      const sha = url.pathname.slice("/api/sops/files/".length);
      if (!/^[a-f0-9]{64}$/i.test(sha)) return json({ ok: false, error: "invalid_file_id" }, 400);
      return handleSopFileDownload(request, env, sha);
    }
    if (url.pathname === "/api/chat/directory" && request.method === "GET") return handleChatDirectory(request, env);
    if (url.pathname === "/api/chat/conversations" && request.method === "GET") return handleChatConversations(request, env);
    if (url.pathname === "/api/chat/conversations" && request.method === "POST") return handleChatConversationCreate(request, env);
    if (url.pathname === "/api/chat/conversations/update" && request.method === "POST") return handleChatConversationUpdate(request, env);
    if (url.pathname === "/api/chat/messages" && request.method === "GET") return handleChatMessages(request, env);
    if (url.pathname === "/api/chat/messages" && request.method === "POST") return handleChatMessageSend(request, env);
    if (url.pathname === "/api/chat/read" && request.method === "POST") return handleChatRead(request, env);
    if (url.pathname === "/api/chat/inbox" && request.method === "GET") return handleChatInbox(request, env);
    if (url.pathname === "/api/profiles" && request.method === "GET") return handleProfilesList(request, env);
    if (url.pathname === "/api/profiles/avatar" && request.method === "POST") return handleProfileAvatarUpload(request, env);
    if (url.pathname === "/api/profiles/avatar/remove" && request.method === "POST") return handleProfileAvatarRemove(request, env);
    if (url.pathname.startsWith("/api/profiles/avatar/") && request.method === "GET") {
      const sha = url.pathname.slice("/api/profiles/avatar/".length);
      return handleProfileAvatarDownload(request, env, sha);
    }
    if (url.pathname === "/api/gifs/search" && request.method === "GET") return handleGifsSearch(request, env);
    if (url.pathname === "/api/gifs/trending" && request.method === "GET") return handleGifsTrending(request, env);
    if (url.pathname === "/api/errors" && request.method === "POST") return handleErrorReport(request, env);
    if (url.pathname === "/api/errors" && request.method === "GET") return handleErrorList(request, env);
    if (url.pathname === "/api/ui/manifest" && request.method === "GET") return handleUiManifest(request, env);
    if (url.pathname === "/api/ui/bundle" && request.method === "GET") return handleUiBundle(request, env);
    if (url.pathname === "/api/fsts" && request.method === "GET") return handleFstList(request, env);
    if (url.pathname === "/api/fsts/upsert" && request.method === "POST") return handleFstUpsert(request, env);
    if (url.pathname === "/api/supervisor/index" && request.method === "GET") return handleSupervisorIndex(request, env);
    if (url.pathname === "/api/supervisor/record" && request.method === "GET") return handleSupervisorRecord(request, env);
    if (url.pathname === "/api/supervisor/upsert" && request.method === "POST") return handleSupervisorUpsert(request, env);
    if (url.pathname === "/api/supervisor/delete" && request.method === "POST") return handleSupervisorDelete(request, env);
    return json({ error: "not_found" }, 404);
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await pushToBase44(message.body, env);
        message.ack();
      } catch (err) {
        if (err.retryable) throw err;
        await markOutboundStatus(env.DB, message.body.itemId, "error", { errorMessage: err.message });
        message.ack();
      }
    }
  },
};

export { QuoteSyncRoom };