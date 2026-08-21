const actionLevels = {
  "read-evidence": "observe",
  "create-task": "propose",
  "create-pr": "propose",
  "safe-retry": "execute-safe",
  "refresh-index": "execute-safe",
  "refresh-snapshot": "execute-safe",
  "approved-experiment": "execute-safe",
  deploy: "approve-required",
  migration: "approve-required",
  dns: "approve-required",
  credentials: "approve-required",
  deletion: "approve-required",
  "rate-limit": "approve-required",
  "public-claim": "approve-required",
  "external-publish": "approve-required"
};

function actionLevel(action) {
  return actionLevels[action] || "approve-required";
}

export function evaluateAction({ entry, action, approved = false, approvalReference = null }) {
  const requiredLevel = actionLevel(action);
  if (!entry || entry.actionPolicy === "excluded") {
    return { authorized: false, requiredLevel, reason: "project is excluded from routine automation" };
  }
  if (requiredLevel === "approve-required" && !(approved && approvalReference)) {
    return { authorized: false, requiredLevel, reason: "explicit approval reference required" };
  }
  if (action === "approved-experiment" && !(approved && approvalReference)) {
    return { authorized: false, requiredLevel, reason: "experiment approval reference required" };
  }
  return { authorized: true, requiredLevel, reason: approved ? "explicit approval recorded" : "within safe automatic authority" };
}
