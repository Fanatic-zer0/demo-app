#!/usr/bin/env bash
set -euo pipefail

NAMESPACE=${NAMESPACE:-oms-demo}
RELEASE=${RELEASE:-oms-demo}
BACKUP_ROOT=${BACKUP_ROOT:-backups/minikube}
IMAGE_REGISTRY=${IMAGE_REGISTRY:-ghcr.io/example/oms-demo}
IMAGE_TAG=${IMAGE_TAG:-0.1.0}
STAMP=${1:-$(date +%Y%m%d-%H%M%S)}
BACKUP_DIR=${BACKUP_ROOT}/${STAMP}

SERVICES=(order-service inventory-service payment-service shipping-service notification-service web-ui)

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing required command: $1" >&2; exit 1; }
}

require_command kubectl
require_command helm
require_command minikube
require_command docker

mkdir -p "${BACKUP_DIR}" "${BACKUP_DIR}/images" "${BACKUP_DIR}/k8s" "${BACKUP_DIR}/redis/strings" "${BACKUP_DIR}/redis/sets"

context=$(kubectl config current-context)
if [[ "${context}" != "minikube" ]]; then
  echo "refusing to backup context '${context}'. Set the current context to minikube first." >&2
  exit 1
fi

kubectl get namespace "${NAMESPACE}" >/dev/null
helm status "${RELEASE}" -n "${NAMESPACE}" >/dev/null

cat > "${BACKUP_DIR}/metadata.env" <<EOF
NAMESPACE=${NAMESPACE}
RELEASE=${RELEASE}
IMAGE_REGISTRY=${IMAGE_REGISTRY}
IMAGE_TAG=${IMAGE_TAG}
CREATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
KUBE_CONTEXT=${context}
EOF

helm get values "${RELEASE}" -n "${NAMESPACE}" -o yaml > "${BACKUP_DIR}/helm-values.yaml"
helm get manifest "${RELEASE}" -n "${NAMESPACE}" > "${BACKUP_DIR}/helm-manifest.yaml"
kubectl -n "${NAMESPACE}" get all,ingress,configmap,secret,pvc,serviceaccount -o yaml > "${BACKUP_DIR}/k8s/namespace-resources.yaml"
kubectl -n "${NAMESPACE}" get kongplugin -o yaml > "${BACKUP_DIR}/k8s/kongplugins.yaml" 2>/dev/null || true
kubectl -n "${NAMESPACE}" get pods -o wide > "${BACKUP_DIR}/k8s/pods.txt"

eval "$(minikube docker-env)"
for service in "${SERVICES[@]}"; do
  image="${IMAGE_REGISTRY}/${service}:${IMAGE_TAG}"
  if docker image inspect "${image}" >/dev/null 2>&1; then
    docker save "${image}" -o "${BACKUP_DIR}/images/${service}.tar"
  else
    echo "warning: image not found in minikube docker daemon: ${image}" >&2
  fi
done

redis_pod=$(kubectl -n "${NAMESPACE}" get pod -l app.kubernetes.io/component=redis -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
if [[ -n "${redis_pod}" ]]; then
  kubectl -n "${NAMESPACE}" exec "${redis_pod}" -- redis-cli --raw keys '*' | sort > "${BACKUP_DIR}/redis/keys.txt"
  while IFS= read -r key; do
    [[ -z "${key}" ]] && continue
    type=$(kubectl -n "${NAMESPACE}" exec "${redis_pod}" -- redis-cli --raw type "${key}")
    case "${type}" in
      string)
        kubectl -n "${NAMESPACE}" exec "${redis_pod}" -- redis-cli --raw get "${key}" > "${BACKUP_DIR}/redis/strings/${key}"
        ;;
      set)
        kubectl -n "${NAMESPACE}" exec "${redis_pod}" -- redis-cli --raw smembers "${key}" | sort > "${BACKUP_DIR}/redis/sets/${key}"
        ;;
      *)
        echo "warning: skipping unsupported Redis key type '${type}' for key '${key}'" >&2
        ;;
    esac
  done < "${BACKUP_DIR}/redis/keys.txt"
fi

echo "backup created: ${BACKUP_DIR}"