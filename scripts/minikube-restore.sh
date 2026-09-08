#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=${1:?usage: scripts/minikube-restore.sh backups/minikube/<snapshot-dir>}
CHART_DIR=${CHART_DIR:-charts/oms-demo}

if [[ ! -f "${BACKUP_DIR}/metadata.env" ]]; then
  echo "backup metadata not found: ${BACKUP_DIR}/metadata.env" >&2
  exit 1
fi

source "${BACKUP_DIR}/metadata.env"

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

require_command kubectl
require_command helm
require_command minikube
require_command docker

context=$(kubectl config current-context)
if [[ "${context}" != "minikube" ]]; then
  echo "refusing to restore into context '${context}'. Set the current context to minikube first." >&2
  exit 1
fi

# Avoid stale corporate proxy variables leaking into minikube's Docker daemon during local image loads.
unset HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy

eval "$(minikube docker-env)"
for image_tar in "${BACKUP_DIR}"/images/*.tar; do
  [[ -e "${image_tar}" ]] || continue
  docker load -i "${image_tar}"
done

kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install "${RELEASE}" "${CHART_DIR}" \
  --namespace "${NAMESPACE}" \
  --create-namespace \
  -f "${BACKUP_DIR}/helm-values.yaml" \
  --set global.imagePullPolicy=Never

kubectl -n "${NAMESPACE}" rollout status deploy/redis --timeout=120s
redis_pod=$(kubectl -n "${NAMESPACE}" get pod -l app.kubernetes.io/component=redis -o jsonpath='{.items[0].metadata.name}')

if [[ -d "${BACKUP_DIR}/redis" ]]; then
  kubectl -n "${NAMESPACE}" exec "${redis_pod}" -- redis-cli flushdb >/dev/null

  for file in "${BACKUP_DIR}"/redis/strings/*; do
    [[ -e "${file}" ]] || continue
    key=$(basename "${file}")
    kubectl -n "${NAMESPACE}" exec -i "${redis_pod}" -- redis-cli -x set "${key}" < "${file}" >/dev/null
  done

  for file in "${BACKUP_DIR}"/redis/sets/*; do
    [[ -e "${file}" ]] || continue
    key=$(basename "${file}")
    while IFS= read -r member; do
      [[ -z "${member}" ]] && continue
      kubectl -n "${NAMESPACE}" exec "${redis_pod}" -- redis-cli sadd "${key}" "${member}" >/dev/null
    done < "${file}"
  done
fi

kubectl -n "${NAMESPACE}" rollout status deploy --timeout=120s
echo "restore complete from: ${BACKUP_DIR}"