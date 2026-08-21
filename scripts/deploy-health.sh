#!/usr/bin/env bash

set -euo pipefail

ROOT="$(pwd)"
TARGETS_FILE="foundry/ops/config/projects.json"
CHECK_GITHUB=true
CHECK_CLOUDFLARE=true
CHECK_STANDARDS=true
GH_LIMIT=10

usage() {
  echo "Usage:"
  echo "  deploy-health.sh                         # check GitHub Actions + Cloudflare targets"
  echo "  deploy-health.sh --root ~/Desktop/fleet  # run from a specific fleet root"
  echo "  deploy-health.sh --targets path.json     # use a specific Fleet project manifest"
  echo "  deploy-health.sh --no-github             # skip GitHub Actions checks"
  echo "  deploy-health.sh --no-cloudflare         # skip Cloudflare deployment checks"
  echo "  deploy-health.sh --no-standards          # skip deploy-standard checks"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT="$2"
      shift 2
      ;;
    --targets)
      TARGETS_FILE="$2"
      shift 2
      ;;
    --no-github)
      CHECK_GITHUB=false
      shift
      ;;
    --no-cloudflare)
      CHECK_CLOUDFLARE=false
      shift
      ;;
    --no-standards)
      CHECK_STANDARDS=false
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

cd "$ROOT"

failures=0
warnings=0

record() {
  local level="$1"
  local message="$2"

  printf '%s %s\n' "$level" "$message"

  case "$level" in
    FAIL) failures=$((failures + 1)) ;;
    WARN) warnings=$((warnings + 1)) ;;
  esac
}

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    record "FAIL" "$command_name is not installed or not on PATH"
    return 1
  fi
}

run_wrangler() {
  if command -v wrangler >/dev/null 2>&1; then
    wrangler "$@"
  else
    npx --yes wrangler "$@"
  fi
}

github_slug_for_repo() {
  local repo="$1"
  local url
  local slug

  url="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"

  case "$url" in
    git@github.com:*)
      slug="${url#git@github.com:}"
      ;;
    https://github.com/*)
      slug="${url#https://github.com/}"
      ;;
    *)
      return 1
      ;;
  esac

  slug="${slug%.git}"
  printf '%s\n' "$slug"
}

origin_main_sha() {
  local repo="$1"

  git -C "$repo" rev-parse origin/main 2>/dev/null ||
    git -C "$repo" rev-parse main 2>/dev/null
}

is_fleet_root_repo() {
  local repo="$1"
  [[ "$(cd "$repo" && pwd)" == "$(cd "$ROOT" && pwd)" ]]
}

is_out_of_fleet_repo() {
  local repo="$1"
  local repo_name

  repo_name="$(basename "$repo")"

  case "$repo_name" in
    open-historia|today-little-log|truehire|companion-robot|device-net-test|forecast-lab|elves-hq|saas-maker-ci-fix)
      return 0
      ;;
  esac

  return 1
}

is_local_only_project() {
  local repo="$1"
  local relative_repo
  local file

  relative_repo="${repo#"$ROOT"/}"
  if [[ -f "$TARGETS_FILE" ]] &&
    jq -e --arg repo "$relative_repo" '
      any(.projects[]?;
        .repo == $repo and .deployKind == "none" and .status != "live"
      )
    ' "$TARGETS_FILE" >/dev/null 2>&1; then
    return 0
  fi

  for file in "$repo/AGENTS.md" "$repo/agents.md" "$repo/README.md" "$repo/PROJECT_STATUS.md"; do
    [[ -f "$file" ]] || continue
    if grep -Eiq 'deploy:[[:space:]]*none|local-only until it earns daily use|no production deploy' "$file"; then
      return 0
    fi
  done

  return 1
}

is_canonical_deploy_project() {
  local repo="$1"
  local relative_repo

  [[ -f "$TARGETS_FILE" ]] || return 1
  relative_repo="${repo#"$ROOT"/}"

  jq -e --arg repo "$relative_repo" '
    any(.projects[]?;
      (.repo == $repo or .sourcePath == $repo)
      and .status == "live"
      and .tier != "out-of-fleet"
      and .tier != "non-product"
      and (.deployKind == "pages" or .deployKind == "worker" or .deployKind == "worker+pages")
    )
  ' "$TARGETS_FILE" >/dev/null 2>&1
}

package_has_deploy_script() {
  local package_json="$1"

  [[ -f "$package_json" ]] &&
    jq -e '(.scripts // {}) | keys[]? | select(. == "deploy" or startswith("deploy:"))' "$package_json" >/dev/null
}

project_has_deploy_entrypoint() {
  local repo="$1"
  local workflow

  if package_has_deploy_script "$repo/package.json"; then
    return 0
  fi

  while IFS= read -r -d '' package_json; do
    if package_has_deploy_script "$package_json"; then
      return 0
    fi
  done < <(
    find "$repo" -mindepth 2 -maxdepth 3 -name package.json \
      -not -path '*/node_modules/*' \
      -not -path '*/.next/*' \
      -not -path '*/dist/*' \
      -not -path '*/out/*' \
      -not -path '*/build/*' \
      -print0
  )

  while IFS= read -r -d '' workflow; do
    if grep -Eqs \
      'cloudflare/(wrangler-action|pages-action)|(^|[[:space:]])wrangler[[:space:]]+(pages[[:space:]]+)?deploy([[:space:]]|$)' \
      "$workflow"; then
      return 0
    fi
  done < <(
    find "$repo/.github/workflows" -maxdepth 1 -type f \
      \( -name '*.yml' -o -name '*.yaml' \) \
      -print0 2>/dev/null
  )

  return 1
}

project_requires_worker_sha_tag() {
  local repo="$1"
  local relative_repo

  [[ -f "$TARGETS_FILE" ]] || return 1
  relative_repo="${repo#"$ROOT"/}"

  jq -e --arg repo "$relative_repo" '
    any(.projects[]?;
      .repo == $repo
      and .status == "live"
      and (.deployKind == "worker" or .deployKind == "worker+pages")
    )
  ' "$TARGETS_FILE" >/dev/null 2>&1
}

project_has_worker_sha_tag() {
  local repo="$1"
  local file

  while IFS= read -r -d '' file; do
    if grep -Fq -- '--tag' "$file" &&
      grep -Eiq 'github\.sha|GITHUB_SHA|git rev-parse HEAD' "$file"; then
      return 0
    fi
  done < <(
    {
      find "$repo/.github/workflows" -maxdepth 1 -type f \
        \( -name '*.yml' -o -name '*.yaml' \) -print0 2>/dev/null
      find "$repo" -maxdepth 4 -type f -name package.json \
        -not -path '*/node_modules/*' \
        -not -path '*/.next/*' \
        -not -path '*/dist/*' \
        -not -path '*/out/*' \
        -not -path '*/build/*' \
        -print0
    }
  )

  return 1
}

repo_dir_for_project() {
  local project="$1"
  local normalized

  case "$project" in
    *) normalized="${project//_/-}" ;;
  esac

  if [[ -d "$ROOT/$project/.git" ]]; then
    printf '%s\n' "$project"
  elif [[ -d "$ROOT/$normalized/.git" ]]; then
    printf '%s\n' "$normalized"
  else
    printf '%s\n' "$normalized"
  fi
}

check_github_actions() {
  echo "== GitHub Actions =="

  if ! require_command gh; then
    return
  fi

  if ! require_command jq; then
    return
  fi

  if ! gh auth status >/dev/null 2>&1; then
    record "FAIL" "gh is not authenticated"
    return
  fi

  while IFS= read -r -d '' gitdir; do
    local repo
    local slug
    local head_sha
    local runs_json
    local active_workflows_json
    local current_runs_json
    local run_count
    local bad_count
    local bad_summary
    local skipped_count
    local skipped_summary
    local latest_summary
    local at_head_count
    local evidence_sha
    local inherited_bot_commits

    repo="${gitdir%/.git}"

    if is_fleet_root_repo "$repo" || is_out_of_fleet_repo "$repo"; then
      continue
    fi

    if is_local_only_project "$repo"; then
      record "OK" "$repo is local-only; GitHub Actions not required"
      continue
    fi

    if ! is_canonical_deploy_project "$repo"; then
      record "OK" "$repo is outside canonical deploy scope; GitHub Actions not required"
      continue
    fi

    slug="$(github_slug_for_repo "$repo" || true)"

    if [[ -z "$slug" ]]; then
      record "WARN" "$repo has no GitHub origin remote"
      continue
    fi

    head_sha="$(origin_main_sha "$repo" || true)"

    if [[ -z "$head_sha" ]]; then
      record "WARN" "$repo cannot resolve origin/main or main"
      continue
    fi

    if ! runs_json="$(gh run list -R "$slug" --branch main --event push --limit "$GH_LIMIT" \
      --json databaseId,status,conclusion,workflowName,headBranch,headSha,createdAt,updatedAt,url 2>/dev/null)"; then
      record "WARN" "$repo GitHub Actions unavailable for $slug"
      continue
    fi

    # `gh run list` includes the last run of workflows that have since been
    # deleted from the default branch. Only current workflow definitions should
    # contribute to deploy readiness.
    if active_workflows_json="$(
      gh api "repos/$slug/actions/workflows?per_page=100" \
        --jq '[.workflows[]? | select(.state != "deleted") | .name]' 2>/dev/null
    )"; then
      runs_json="$(
        jq --argjson workflows "$active_workflows_json" \
          '[.[] | select(.workflowName as $name | $workflows | index($name))]' \
          <<<"$runs_json"
      )"
    fi

    run_count="$(jq 'length' <<<"$runs_json")"

    if [[ "$run_count" -eq 0 ]]; then
      record "FAIL" "$repo has no GitHub Actions runs on main"
      continue
    fi

    current_runs_json="$(
      jq 'sort_by(.createdAt) | reverse | reduce .[] as $run ({}; if has($run.workflowName) then . else .[$run.workflowName] = $run end) | [.[]]' \
        <<<"$runs_json"
    )"
    evidence_sha="$head_sha"
    inherited_bot_commits=0
    at_head_count="$(jq --arg sha "$head_sha" '[.[] | select(.headSha == $sha)] | length' <<<"$current_runs_json")"

    # Scheduled data-refresh workflows commonly commit generated artifacts with
    # github-actions[bot] while intentionally suppressing another push run.
    # In that case, inherit the nearest human ancestor's exact push-CI evidence.
    while [[ "$at_head_count" -eq 0 && "$inherited_bot_commits" -lt 10 ]] &&
      [[ "$(git -C "$repo" show -s --format=%ae "$evidence_sha" 2>/dev/null || true)" == *"[bot]@users.noreply.github.com" ]]; do
      evidence_sha="$(git -C "$repo" rev-parse "$evidence_sha^" 2>/dev/null || true)"
      [[ -n "$evidence_sha" ]] || break
      inherited_bot_commits=$((inherited_bot_commits + 1))
      at_head_count="$(jq --arg sha "$evidence_sha" '[.[] | select(.headSha == $sha)] | length' <<<"$current_runs_json")"
    done

    bad_count="$(
      jq --arg sha "$evidence_sha" \
        '[.[] | select(.headSha == $sha) | select(.status != "completed" or (.conclusion as $conclusion | ["failure","cancelled","timed_out","action_required","startup_failure"] | index($conclusion)))] | length' \
        <<<"$current_runs_json"
    )"
    bad_summary="$(
      jq -r --arg sha "$evidence_sha" \
        '[.[] | select(.headSha == $sha) | select(.status != "completed" or (.conclusion as $conclusion | ["failure","cancelled","timed_out","action_required","startup_failure"] | index($conclusion))) | "\(.workflowName)=\(.status)/\(.conclusion // "none")@\(.headSha[0:7]) \(.url)"] | join("; ")' \
        <<<"$current_runs_json"
    )"
    skipped_count="$(jq --arg sha "$evidence_sha" '[.[] | select(.headSha == $sha and .conclusion == "skipped")] | length' <<<"$current_runs_json")"
    skipped_summary="$(
      jq -r --arg sha "$evidence_sha" '[.[] | select(.headSha == $sha and .conclusion == "skipped") | "\(.workflowName)@\(.headSha[0:7])"] | join("; ")' \
        <<<"$current_runs_json"
    )"
    latest_summary="$(
      jq -r '.[0] | "\(.workflowName): \(.status)/\(.conclusion // "none") \(.headSha[0:7]) \(.url)"' \
        <<<"$runs_json"
    )"

    if [[ "$bad_count" -gt 0 ]]; then
      record "FAIL" "$repo has failing/running latest workflow Actions ($bad_count): $bad_summary; latest $latest_summary"
    elif [[ "$at_head_count" -eq 0 ]]; then
      record "WARN" "$repo has no recent Actions run at origin/main ${head_sha:0:7}; latest $latest_summary"
    elif [[ "$skipped_count" -gt 0 ]]; then
      record "WARN" "$repo has skipped latest workflow Actions ($skipped_count): $skipped_summary; latest $latest_summary"
    elif [[ "$inherited_bot_commits" -gt 0 ]]; then
      record "OK" "$repo Actions clean at ${evidence_sha:0:7}; origin/main ${head_sha:0:7} adds $inherited_bot_commits bot-generated commit(s)"
    else
      record "OK" "$repo Actions clean; latest $latest_summary"
    fi
  done < <(find "$ROOT" -maxdepth 2 -type d -name ".git" -prune -print0)

  echo
}

check_project_standards() {
  echo "== Project Deploy Standards =="

  if ! require_command jq; then
    return
  fi

  while IFS= read -r -d '' gitdir; do
    local repo
    local workflow_count

    repo="${gitdir%/.git}"

    if is_fleet_root_repo "$repo" || is_out_of_fleet_repo "$repo"; then
      continue
    fi

    if is_local_only_project "$repo"; then
      record "OK" "$repo is local-only; deploy standard not required"
      continue
    fi

    if ! is_canonical_deploy_project "$repo"; then
      record "OK" "$repo is outside canonical deploy scope; deploy standard not required"
      continue
    fi

    if [[ -d "$repo/.github/workflows" ]]; then
      workflow_count="$(
        find "$repo/.github/workflows" -maxdepth 1 -type f \( -name '*.yml' -o -name '*.yaml' \) 2>/dev/null | wc -l | tr -d ' '
      )"
    else
      workflow_count=0
    fi

    if [[ "$workflow_count" -eq 0 ]]; then
      record "FAIL" "$repo has no GitHub Actions workflow files"
    else
      record "OK" "$repo has GitHub Actions workflow files ($workflow_count)"
    fi

    if project_has_deploy_entrypoint "$repo"; then
      record "OK" "$repo has a deploy entrypoint"
    else
      record "FAIL" "$repo has no deploy entrypoint"
    fi

    if project_requires_worker_sha_tag "$repo"; then
      if project_has_worker_sha_tag "$repo"; then
        record "OK" "$repo Worker deploys record the Git SHA with --tag"
      else
        record "FAIL" "$repo Worker deploys do not record the Git SHA with --tag"
      fi
    fi
  done < <(find "$ROOT" -maxdepth 2 -type d -name ".git" -prune -print0)

  echo
}

check_pages_target() {
  local repo="$1"
  local target_name="$2"
  local head_sha="$3"
  local deployments_json
  local source
  local branch
  local deployment_url
  local build_url

  if ! deployments_json="$(run_wrangler pages deployment list \
    --project-name "$target_name" \
    --environment production \
    --json 2>/dev/null)"; then
    record "FAIL" "$repo Cloudflare Pages $target_name deployment list failed"
    return
  fi

  if [[ "$(jq 'length' <<<"$deployments_json")" -eq 0 ]]; then
    record "FAIL" "$repo Cloudflare Pages $target_name has no production deployments"
    return
  fi

  source="$(jq -r '.[0].Source // .[0].source // ""' <<<"$deployments_json")"
  branch="$(jq -r '.[0].Branch // .[0].branch // ""' <<<"$deployments_json")"
  deployment_url="$(jq -r '.[0].Deployment // .[0].deployment_url // ""' <<<"$deployments_json")"
  build_url="$(jq -r '.[0].Build // ""' <<<"$deployments_json")"

  if [[ -n "$source" && -n "$head_sha" && "${head_sha:0:${#source}}" == "$source" ]]; then
    record "OK" "$repo Pages $target_name deployed ${source} from ${branch:-unknown} ($deployment_url)"
  elif [[ -n "$source" && -n "$head_sha" ]]; then
    record "FAIL" "$repo Pages $target_name is not at origin/main ${head_sha:0:7}; latest deployment source $source ($build_url)"
  else
    record "WARN" "$repo Pages $target_name deployment exists but commit source is unavailable ($deployment_url)"
  fi
}

check_worker_target() {
  local repo="$1"
  local target_name="$2"
  local head_sha="$3"
  local deployments_json
  local versions_json
  local deployment_id
  local created_on
  local max_percentage
  local active_version_id
  local deployed_sha

  if ! deployments_json="$(run_wrangler deployments list --name "$target_name" --json 2>/dev/null)"; then
    record "FAIL" "$repo Worker $target_name deployment list failed"
    return
  fi

  if [[ "$(jq 'length' <<<"$deployments_json")" -eq 0 ]]; then
    record "FAIL" "$repo Worker $target_name has no deployments"
    return
  fi

  deployment_id="$(jq -r 'sort_by(.created_on) | last | .id // ""' <<<"$deployments_json")"
  created_on="$(jq -r 'sort_by(.created_on) | last | .created_on // ""' <<<"$deployments_json")"
  max_percentage="$(jq -r 'sort_by(.created_on) | last | [.versions[]?.percentage] | max // 0' <<<"$deployments_json")"
  active_version_id="$(
    jq -r 'sort_by(.created_on) | last | [.versions[]? | select(.percentage == 100)][0].version_id // ""' \
      <<<"$deployments_json"
  )"

  if [[ "$max_percentage" != "100" ]]; then
    record "WARN" "$repo Worker $target_name latest deployment is not 100% traffic ($max_percentage%) id=$deployment_id"
    return
  fi

  if [[ -z "$active_version_id" ]]; then
    record "FAIL" "$repo Worker $target_name has 100% traffic but no active version id in deployment $deployment_id"
    return
  fi

  if ! versions_json="$(run_wrangler versions list --name "$target_name" --json 2>/dev/null)"; then
    record "FAIL" "$repo Worker $target_name version list failed"
    return
  fi

  deployed_sha="$(
    jq -r --arg version_id "$active_version_id" \
      '[.[] | select(.id == $version_id)][0].annotations["workers/tag"] // ""' \
      <<<"$versions_json"
  )"

  if [[ ! "$deployed_sha" =~ ^[0-9a-fA-F]{40}$ ]]; then
    record "WARN" "$repo Worker $target_name is active at 100% but version $active_version_id has no full Git SHA tag; deployed commit unknown"
  elif [[ -z "$head_sha" ]]; then
    record "WARN" "$repo Worker $target_name deployed ${deployed_sha:0:7} but origin/main is unavailable"
  elif [[ "$deployed_sha" == "$head_sha" ]]; then
    record "OK" "$repo Worker $target_name deployed ${deployed_sha:0:7} from main at 100% ($created_on)"
  else
    record "FAIL" "$repo Worker $target_name is not at origin/main ${head_sha:0:7}; active version deploys ${deployed_sha:0:7} at 100% ($created_on)"
  fi
}

check_cloudflare_targets() {
  echo "== Cloudflare Deployments =="

  local automation_registry="$ROOT/foundry/ops/config/automation-registry.json"
  local ignored_projects_json="[]"

  if ! require_command jq; then
    return
  fi

  if [[ ! -f "$TARGETS_FILE" ]]; then
    record "FAIL" "Cloudflare targets file not found: $TARGETS_FILE"
    return
  fi

  if ! command -v wrangler >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
    record "FAIL" "wrangler is not installed and npx is unavailable"
    return
  fi

  if ! run_wrangler whoami >/dev/null 2>&1; then
    record "FAIL" "wrangler is not authenticated"
    return
  fi

  if [[ -f "$automation_registry" ]]; then
    ignored_projects_json="$(
      jq '[.entries[]? | select(.attention == "ignored") | {id, repository}]' \
        "$automation_registry"
    )"

    while IFS= read -r project; do
      record "OK" "$project Cloudflare parity skipped: ignored/inactive; explicit reactivation required"
    done < <(
      jq -r --argjson ignored "$ignored_projects_json" '
        [.projects[]
          | . as $project
          | select(
              any($ignored[];
                .id == $project.id
                or (.repository != null and .repository == $project.repo)
              )
            )
          | $project.id
        ] | unique[]
      ' "$TARGETS_FILE"
    )
  fi

  while IFS=$'\t' read -r project target_id kind target_name source_path; do
    local repo_path
    local head_sha

    head_sha=""

    repo_path="$ROOT/$source_path"
    if [[ -n "$source_path" ]] &&
      git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      head_sha="$(origin_main_sha "$repo_path" || true)"
    else
      record "WARN" "$project/$target_id $kind target has no available source checkout at ${source_path:-<unset>}"
    fi

    case "$kind" in
      pages)
        check_pages_target "$project" "$target_name" "$head_sha"
        ;;
      worker)
        check_worker_target "$project" "$target_name" "$head_sha"
        ;;
      *)
        record "WARN" "$project target $target_id has unknown Cloudflare kind: $kind"
        ;;
    esac
  done < <(
    jq -r --argjson ignored "$ignored_projects_json" '.projects[]
      | . as $project
      | select(
          .status == "live"
          and .tier != "out-of-fleet"
          and .tier != "non-product"
          and (
            any($ignored[];
              .id == $project.id
              or (.repository != null and .repository == $project.repo)
            ) | not
          )
          and (.deployKind == "pages" or .deployKind == "worker" or .deployKind == "worker+pages")
        )
      | . as $project
      | if (($project.deployTargets // []) | length) > 0 then
          $project.deployTargets[]
          | [
              $project.id,
              (.id // .name),
              .kind,
              .name,
              (.sourcePath // $project.sourcePath // $project.repo // "")
            ]
        elif ($project.deployKind == "pages" or $project.deployKind == "worker") then
          ($project.cfProject | split(",")[] | gsub("^\\s+|\\s+$"; "")) as $target
          | [
              $project.id,
              $project.id,
              $project.deployKind,
              $target,
              ($project.sourcePath // $project.repo // "")
            ]
        else
          empty
        end
      | @tsv' \
      "$TARGETS_FILE"
  )

  echo
}

if [[ "$CHECK_STANDARDS" == true ]]; then
  check_project_standards
fi

if [[ "$CHECK_GITHUB" == true ]]; then
  check_github_actions
fi

if [[ "$CHECK_CLOUDFLARE" == true ]]; then
  check_cloudflare_targets
fi

echo "== Summary =="
echo "Failures: $failures"
echo "Warnings: $warnings"

if [[ "$failures" -gt 0 ]]; then
  exit 1
fi
