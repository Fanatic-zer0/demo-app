# OMS Demo Platform

Realistic order management microservices demo for Jenkins, Kong, Helm, Argo CD, Kubernetes, and minikube. This is intended as a developer-to-DevOps handoff: the app works end to end, has multiple services and routes, uses a lightweight backing store, emits trace IDs, and can be built, deployed, tested, backed up, and restored locally.

## What This App Demonstrates

- Six deployable images: five business services plus a web UI/gateway.
- Real order workflow: inventory reservation -> payment authorization -> payment capture -> shipment creation -> notification.
- Compensation logic: if payment or shipment creation fails, reserved inventory is released.
- Shared Redis persistence: POST data is visible across multiple Kubernetes replicas.
- Trace propagation: every request has `X-Trace-Id`, response header `X-Trace-Id`, and JSON field `traceId`.
- Kong ingress routing by path prefix.
- Helm chart deployment with resource limits, probes, Redis, PVC, Kong plugins, and ingress.
- Jenkins pipeline for test, Helm render, image build, image scan, push, and GitOps values update.
- Argo CD application manifest for GitOps deployment.
- minikube backup/restore scripts for local demo recovery.

## Architecture

```text
Browser
  |
  | http://localhost:8090 or Kong host oms-demo.local
  v
web-ui / Kong route layer
  |
  +-- /api/v1/orders        -> order-service
  +-- /api/v1/inventory     -> inventory-service
  +-- /api/v1/payments      -> payment-service
  +-- /api/v1/shipments     -> shipping-service
  +-- /api/v1/notifications -> notification-service
  +-- /                      -> web-ui dashboard

order-service
  |
  +-- reserves stock in inventory-service
  +-- authorizes and captures payment in payment-service
  +-- creates shipment in shipping-service
  +-- queues notification in notification-service

All business services -> Redis -> PersistentVolumeClaim in Kubernetes
```

## Services

| Service | Local port | Kubernetes replicas | Data store | Purpose |
| --- | ---: | ---: | --- | --- |
| `order-service` | 8081 | 2 | Redis | Order API and saga orchestration. |
| `inventory-service` | 8082 | 2 | Redis | Product inventory and reservations. |
| `payment-service` | 8083 | 2 | Redis | Payment authorization, capture, and refunds. |
| `shipping-service` | 8084 | 2 | Redis | Shipment creation and tracking. |
| `notification-service` | 8085 | 2 | Redis | Customer notification queue and retry. |
| `web-ui` | 8090 | 1 | None | Dashboard and local API reverse proxy. |
| `redis` | 6379 | 1 | PVC | Lightweight persistent backing store for the demo. |

Every HTTP service exposes:

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

## API Details

### Orders

Base path: `/api/v1/orders`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/orders` | List orders. Optional query: `?status=CONFIRMED`. |
| `POST` | `/api/v1/orders` | Create an order and orchestrate inventory, payment, shipping, notification. |
| `GET` | `/api/v1/orders/{id}` | Get one order. |
| `PATCH` | `/api/v1/orders/{id}` | Patch order fields. |
| `POST` | `/api/v1/orders/{id}/cancel` | Mark an order cancelled. |
| `GET` | `/api/v1/orders/{id}/tracking` | Fetch live shipment tracking from `shipping-service`. |

Create order request:

```json
{
  "customerId": "cust-900",
  "items": [
    { "sku": "SKU-BAG-001", "quantity": 1, "price": 89.99 }
  ],
  "currency": "USD",
  "paymentMethodToken": "tok_demo",
  "shippingAddress": { "city": "Seattle", "country": "US" }
}
```

Create order response:

```json
{
  "id": "ord-...",
  "customerId": "cust-900",
  "status": "CONFIRMED",
  "total": 89.99,
  "currency": "USD",
  "paymentId": "pay-...",
  "shipmentId": "shp-...",
  "trackingNumber": "DX...",
  "traceId": "..."
}
```

### Inventory

Base path: `/api/v1/inventory`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/inventory` | List SKUs. |
| `GET` | `/api/v1/inventory/{sku}` | Get one SKU. |
| `POST` | `/api/v1/inventory/{sku}/reservations` | Reserve stock for an order. |
| `DELETE` | `/api/v1/inventory/{sku}/reservations/{reservationId}` | Release a reservation and restore exact quantity. |

Reservation request:

```json
{ "orderId": "ord-123", "quantity": 2 }
```

### Payments

Base path: `/api/v1/payments`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/payments` | List payments. Optional query: `?orderId=ord-...`. |
| `POST` | `/api/v1/payments` | Authorize a payment. |
| `GET` | `/api/v1/payments/{id}` | Get payment details. |
| `POST` | `/api/v1/payments/{id}/capture` | Capture an authorized payment. |
| `POST` | `/api/v1/payments/{id}/refunds` | Request a refund. |

Payment request:

```json
{
  "orderId": "ord-123",
  "amount": 89.99,
  "currency": "USD",
  "paymentMethodToken": "tok_demo"
}
```

### Shipping

Base path: `/api/v1/shipments`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/shipments` | List shipments. |
| `POST` | `/api/v1/shipments` | Create a shipment. |
| `GET` | `/api/v1/shipments/{id}` | Get shipment details. |
| `GET` | `/api/v1/shipments/orders/{orderId}` | Find shipments by order. |
| `GET` | `/api/v1/shipments/{id}/tracking` | Get tracking status and checkpoints. |

Shipment request:

```json
{
  "orderId": "ord-123",
  "carrier": "demo-express",
  "address": { "city": "Seattle", "country": "US" }
}
```

### Notifications

Base path: `/api/v1/notifications`

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/notifications` | List notifications. |
| `POST` | `/api/v1/notifications` | Queue a notification. |
| `GET` | `/api/v1/notifications/{id}` | Get notification details. |
| `GET` | `/api/v1/notifications/customers/{customerId}` | List notifications for a customer. |
| `POST` | `/api/v1/notifications/{id}/retry` | Retry a notification. |

Notification request:

```json
{
  "customerId": "cust-900",
  "channel": "email",
  "template": "order-confirmed",
  "payload": { "orderId": "ord-123" }
}
```

## Trace IDs

The shared HTTP layer accepts an incoming `X-Trace-Id` or `X-Correlation-Id`. If neither exists, it generates a UUID. The trace id is then:

- logged by every service,
- returned as response header `X-Trace-Id`,
- included in JSON responses as `traceId`,
- propagated to downstream service calls by `order-service`.

Example:

```bash
curl -i -X POST http://localhost:8090/api/v1/orders \
  -H 'content-type: application/json' \
  -H 'x-trace-id: demo-trace-001' \
  -d '{"customerId":"cust-900","items":[{"sku":"SKU-BAG-001","quantity":1,"price":89.99}],"shippingAddress":{"city":"Seattle","country":"US"}}'
```

Use the trace id to correlate logs:

```bash
kubectl -n oms-demo logs -l app.kubernetes.io/component=order-service --tail=100 | grep demo-trace-001
kubectl -n oms-demo logs -l app.kubernetes.io/component=inventory-service --tail=100 | grep demo-trace-001
kubectl -n oms-demo logs -l app.kubernetes.io/component=payment-service --tail=100 | grep demo-trace-001
```

## Local Development

Prerequisites:

- Node.js 22 or compatible modern Node runtime
- Docker / Docker Compose
- Helm
- kubectl
- minikube for local Kubernetes deployment

Install and test:

```bash
npm install
npm test
```

Run locally with Docker Compose:

```bash
docker compose up --build
```

Open the dashboard:

```text
http://localhost:8090
```

Useful local calls:

```bash
curl http://localhost:8090/api/v1/orders
curl http://localhost:8090/api/v1/inventory
curl http://localhost:8090/api/v1/shipments
```

Direct service ports are also exposed for debugging:

- `order-service`: `http://localhost:8081`
- `inventory-service`: `http://localhost:8082`
- `payment-service`: `http://localhost:8083`
- `shipping-service`: `http://localhost:8084`
- `notification-service`: `http://localhost:8085`
- `redis`: `localhost:6379`

## Kubernetes Deployment With Helm

Validate the chart:

```bash
helm lint charts/oms-demo
helm template oms-demo charts/oms-demo
```

Default chart values:

- Namespace: `oms-demo`
- Image registry prefix: `ghcr.io/example/oms-demo`
- Image tag: `0.1.0`
- Image pull policy: `Never` for minikube/local image workflow
- Redis: enabled, `redis:7-alpine`, 1Gi PVC
- Kong ingress host: `oms-demo.local`

Install or upgrade:

```bash
helm upgrade --install oms-demo charts/oms-demo \
  --namespace oms-demo \
  --create-namespace \
  --set global.imageRegistry=ghcr.io/example/oms-demo \
  --set global.imageTag=0.1.0 \
  --set global.imagePullPolicy=Never
```

Wait for rollout:

```bash
kubectl -n oms-demo rollout status deploy --timeout=120s
kubectl -n oms-demo get pods -o wide
```

## minikube Image Workflow

minikube runs its own Docker daemon. Images built on the host are not automatically visible inside minikube.

Build all local images into minikube:

```bash
eval $(minikube docker-env)
for s in order-service inventory-service payment-service shipping-service notification-service web-ui; do
  docker build -f services/$s/Dockerfile -t ghcr.io/example/oms-demo/$s:0.1.0 .
done
```

If your shell has stale corporate proxy variables and Docker pulls fail with DNS errors, clear them before building:

```bash
unset HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy
```

After code changes, rebuild the changed image and restart that deployment:

```bash
eval $(minikube docker-env)
docker build -f services/order-service/Dockerfile -t ghcr.io/example/oms-demo/order-service:0.1.0 .
kubectl -n oms-demo rollout restart deploy/order-service
kubectl -n oms-demo rollout status deploy/order-service --timeout=120s
```

Because the demo tag stays `0.1.0`, restarting without rebuilding will not pick up code changes.

## Kong Routing

The Helm chart creates one Kong Ingress using `ingressClassName: kong`.

```text
/api/v1/orders        -> order-service:8080
/api/v1/inventory     -> inventory-service:8080
/api/v1/payments      -> payment-service:8080
/api/v1/shipments     -> shipping-service:8080
/api/v1/notifications -> notification-service:8080
/                      -> web-ui:8080
```

The chart also creates optional Kong plugins:

- `oms-correlation-id`: adds/echoes a correlation id.
- `oms-rate-limit`: demo rate limit of 120 requests/minute.

Test through Kong after pointing `oms-demo.local` at the Kong proxy:

```bash
curl -H 'host: oms-demo.local' http://<kong-proxy>/
curl -H 'host: oms-demo.local' http://<kong-proxy>/api/v1/orders
```

If you do not have Kong exposed locally, use port-forward:

```bash
kubectl -n oms-demo port-forward svc/web-ui 8090:8080
open http://localhost:8090
```

## Jenkins Pipeline

The [Jenkinsfile](Jenkinsfile) is designed for CI building this repo and then updating a GitOps repository.

Pipeline stages:

1. `Install & Test`: `npm ci`, then `npm test`.
2. `Render Helm`: `helm lint`, `helm template`, archive `rendered.yaml`.
3. `Build Images`: builds all six app images.
4. `Scan Images`: runs Trivy high/critical vulnerability scan for each image.
5. `Push Images`: logs in to the registry and pushes versioned + latest tags.
6. `Update GitOps Values`: on `main`, updates Helm values in the GitOps repo with `yq`.

Required Jenkins tools/plugins or equivalents:

- Node.js/npm available on the agent
- Docker CLI access to a daemon
- Helm
- Trivy
- Git and SSH client
- `yq`
- Credentials Binding plugin

Required Jenkins credentials:

| Credential ID | Type | Purpose |
| --- | --- | --- |
| `container-registry-creds` | Username/password | Docker registry login. |
| `gitops-ssh-key` | SSH private key | Push updated Helm values to GitOps repo. |

Jenkins parameters:

| Parameter | Default | Description |
| --- | --- | --- |
| `REGISTRY` | `ghcr.io/example/oms-demo` | Image registry/repository prefix. |
| `GITOPS_REPO` | `git@github.com:example/devops.git` | GitOps repository SSH URL. |
| `HELM_VALUES_PATH` | `demo-app/charts/oms-demo/values.yaml` | Values file Jenkins updates. |

Generated image tag format:

```text
${BUILD_NUMBER}-${GIT_COMMIT.take(7)}
```

For a real environment, change the placeholder registry/repo values to your registry and GitOps repository.

## Argo CD Deployment

Argo CD manifest: [argocd/oms-demo-staging.yaml](argocd/oms-demo-staging.yaml)

It points Argo CD to:

- repo URL: `https://github.com/example/devops.git`
- chart path: `demo-app/charts/oms-demo`
- release name: `oms-demo`
- namespace: `oms-demo-staging`
- sync policy: automated prune + self-heal

Apply the Argo CD application:

```bash
kubectl apply -f argocd/oms-demo-staging.yaml
argocd app sync oms-demo-staging
argocd app wait oms-demo-staging --health --sync --timeout 300
```

Before using it in a real repo, update:

- `spec.source.repoURL`
- `spec.source.targetRevision`
- `spec.source.helm.values.global.imageRegistry`
- `spec.source.helm.values.global.imageTag`
- `spec.source.helm.values.kong.ingress.host`

## Runtime Configuration

Business service environment variables:

| Variable | Example | Used by |
| --- | --- | --- |
| `PORT` | `8080` | All services. |
| `REDIS_URL` | `redis://redis:6379` | order, inventory, payment, shipping, notification. |
| `INVENTORY_SERVICE_URL` | `http://inventory-service:8080` | order-service, web-ui proxy. |
| `PAYMENT_SERVICE_URL` | `http://payment-service:8080` | order-service, web-ui proxy. |
| `SHIPPING_SERVICE_URL` | `http://shipping-service:8080` | order-service, web-ui proxy. |
| `NOTIFICATION_SERVICE_URL` | `http://notification-service:8080` | order-service, web-ui proxy. |
| `ORDER_SERVICE_URL` | `http://order-service:8080` | web-ui proxy. |

The Helm chart injects `REDIS_URL` only into services with `needsRedis: true`.

## Data Model In Redis

The shared store uses namespaced Redis keys.

| Entity | Key pattern |
| --- | --- |
| Orders | `orders:entry:<orderId>`, `orders:ids` |
| Inventory items | `inventory-items:entry:<sku>`, `inventory-items:ids` |
| Reservations | `inventory-reservations:entry:<reservationId>`, `inventory-reservations:ids` |
| Payments | `payments:entry:<paymentId>`, `payments:ids` |
| Shipments | `shipments:entry:<shipmentId>`, `shipments:ids` |
| Notifications | `notifications:entry:<notificationId>`, `notifications:ids` |

Inspect data:

```bash
kubectl -n oms-demo exec deploy/redis -- redis-cli keys '*'
kubectl -n oms-demo exec deploy/redis -- redis-cli smembers orders:ids
kubectl -n oms-demo exec deploy/redis -- redis-cli get orders:entry:ord-1001
```

## Operational Checks

Pods and rollout:

```bash
kubectl -n oms-demo get deploy,pods,svc,ingress,pvc
kubectl -n oms-demo rollout status deploy --timeout=120s
```

Health checks:

```bash
kubectl -n oms-demo port-forward svc/order-service 8081:8080
curl http://localhost:8081/health/live
curl http://localhost:8081/health/ready
```

End-to-end smoke test through web-ui gateway:

```bash
kubectl -n oms-demo port-forward svc/web-ui 8090:8080
curl -s -X POST http://localhost:8090/api/v1/orders \
  -H 'content-type: application/json' \
  -H 'x-trace-id: smoke-001' \
  -d '{"customerId":"cust-900","items":[{"sku":"SKU-BAG-001","quantity":1,"price":89.99}],"shippingAddress":{"city":"Seattle","country":"US"}}'
curl -s http://localhost:8090/api/v1/orders
curl -s http://localhost:8090/api/v1/inventory/SKU-BAG-001
```

Logs by trace id:

```bash
kubectl -n oms-demo logs -l app.kubernetes.io/component=order-service --tail=100 | grep smoke-001
```

Common issues:

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ImagePullBackOff` for `ghcr.io/example/...` | Image not in minikube or pull policy wrong. | Build into minikube Docker daemon and use `global.imagePullPolicy=Never`. |
| POST succeeds but GET misses data | Service is using memory fallback, not Redis. | Confirm `REDIS_URL` env exists and Redis is running. |
| `ECONNREFUSED redis:6379` at startup | App pod started before Redis was ready. | Client reconnects automatically; wait for rollout. For production, add init/startup gating. |
| Kong returns 404 | Host/path mismatch or Kong ingress not installed. | Check `ingressClassName`, `oms-demo.local` host, and Kong proxy address. |
| Docker build cannot resolve `docker.io` | Stale proxy env vars. | Unset `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and lowercase variants. |

## Backup and Restore minikube State

Create a snapshot:

```bash
./scripts/minikube-backup.sh
```

Each snapshot is written under `backups/minikube/<timestamp>/` and includes:

- Helm values and rendered release manifest
- Kubernetes namespace resources for `oms-demo`
- All six local service images from minikube's Docker daemon
- Redis application data

Restore from a snapshot:

```bash
./scripts/minikube-restore.sh backups/minikube/<timestamp>
```

The restore script reloads local images, runs `helm upgrade --install`, restores Redis data, and waits for every deployment to roll out. It restores the demo app namespace state, not the entire minikube VM or unrelated cluster add-ons.

Verified snapshot example from this workspace:

```text
backups/minikube/20260903-113112
```

## File Map

```text
demo-app/
  Jenkinsfile
  docker-compose.yaml
  package.json
  scripts/
    minikube-backup.sh
    minikube-restore.sh
  argocd/
    oms-demo-staging.yaml
  charts/oms-demo/
    Chart.yaml
    values.yaml
    templates/
      namespace.yaml
      services.yaml
      redis.yaml
      kong-ingress.yaml
      kong-plugins.yaml
  services/
    _shared/
      http-app.js
      service-client.js
      store.js
    order-service/
    inventory-service/
    payment-service/
    shipping-service/
    notification-service/
    web-ui/
```

## Handoff Notes For DevOps

- Replace placeholder image registry `ghcr.io/example/oms-demo` with the real registry/repository prefix.
- Replace placeholder GitOps repo URLs in [Jenkinsfile](Jenkinsfile) and [argocd/oms-demo-staging.yaml](argocd/oms-demo-staging.yaml).
- Keep `imagePullPolicy=Never` only for local minikube image workflows. Use `IfNotPresent` or immutable digests in shared clusters.
- Redis in this chart is a single-instance demo store, not an HA production database. For production, use a managed Redis or HA Redis chart with backups and authentication.
- The current demo has no authn/authz. Put auth at Kong or add application auth before exposing outside a lab cluster.
- The `web-ui` proxy is for local/demo convenience. In Kubernetes, Kong should be the external route layer.
- The backup scripts are for minikube/demo recovery. For production, use GitOps, registry retention, Velero, and managed database backups.
- Jenkins requires Docker, Helm, Trivy, Git, SSH, and `yq` on the agent.
- Argo CD should deploy from Git only; CI should update values in Git, not mutate the cluster directly.

