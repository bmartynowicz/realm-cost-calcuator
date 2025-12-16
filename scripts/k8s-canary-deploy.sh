#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <environment> <overlay-path> <deployment-name> <namespace>" >&2
  exit 1
fi

ENVIRONMENT="$1"
OVERLAY_PATH="$2"
DEPLOYMENT_NAME="$3"
NAMESPACE="$4"
CANARY_STEPS="${CANARY_STEPS:-10 50 100}"
ROLLBACK_TIMEOUT="${ROLLBACK_TIMEOUT:-180s}"
SLEEP_BETWEEN_STEPS="${SLEEP_BETWEEN_STEPS:-15}"
APP_LABEL="${APP_LABEL:-app}"
HEALTH_THRESHOLD="${HEALTH_THRESHOLD:-1}"

log() {
  echo "[canary][${ENVIRONMENT}] $1"
}

rollback() {
  log "Health check failed. Rolling back ${DEPLOYMENT_NAME}..."
  kubectl -n "${NAMESPACE}" rollout undo deployment "${DEPLOYMENT_NAME}" || true
  exit 1
}

health_check() {
  local ready desired
  ready=$(kubectl -n "${NAMESPACE}" get deploy "${DEPLOYMENT_NAME}" -o jsonpath='{.status.readyReplicas}')
  desired=$(kubectl -n "${NAMESPACE}" get deploy "${DEPLOYMENT_NAME}" -o jsonpath='{.status.replicas}')
  ready=${ready:-0}
  desired=${desired:-0}
  log "Ready replicas: ${ready}/${desired}"
  if [[ "${ready}" -lt "${HEALTH_THRESHOLD}" ]]; then
    return 1
  fi
  return 0
}

trap rollback ERR

log "Applying overlay ${OVERLAY_PATH}"
if command -v kustomize >/dev/null 2>&1; then
  log "Using kustomize build with LoadRestrictionsNone"
  kustomize build --load-restrictor LoadRestrictionsNone "${OVERLAY_PATH}" | kubectl apply -f -
else
  log "kustomize binary not found; using kubectl apply -k"
  kubectl apply -k "${OVERLAY_PATH}"
fi

log "Waiting for initial rollout"
kubectl -n "${NAMESPACE}" rollout status deployment "${DEPLOYMENT_NAME}" --timeout="${ROLLBACK_TIMEOUT}"

for weight in ${CANARY_STEPS}; do
  log "Shifting traffic for ${DEPLOYMENT_NAME} to ${weight}%"
  kubectl -n "${NAMESPACE}" annotate deployment "${DEPLOYMENT_NAME}" traffic.canary.latitudedev.io/weight="${weight}" --overwrite || true
  sleep "${SLEEP_BETWEEN_STEPS}"
  kubectl -n "${NAMESPACE}" rollout status deployment "${DEPLOYMENT_NAME}" --timeout="${ROLLBACK_TIMEOUT}"
  if ! health_check; then
    rollback
  fi
  log "Canary step ${weight}% healthy"
done

trap - ERR
log "${DEPLOYMENT_NAME} successfully promoted in ${ENVIRONMENT}"
