pipeline {
    agent any

    options {
        timeout(time: 45, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        string(name: 'REGISTRY', defaultValue: 'ghcr.io/example/oms-demo', description: 'Container registry/repository prefix')
        string(name: 'GITOPS_REPO', defaultValue: 'git@github.com:example/devops.git', description: 'GitOps repository SSH URL')
        string(name: 'HELM_VALUES_PATH', defaultValue: 'demo-app/charts/oms-demo/values.yaml', description: 'Values file to update')
    }

    environment {
        IMAGE_TAG = "${BUILD_NUMBER}-${GIT_COMMIT.take(7)}"
        SERVICES = 'order-service inventory-service payment-service shipping-service notification-service web-ui'
    }

    stages {
        stage('Install & Test') {
            steps {
                sh 'npm ci'
                sh 'npm test'
            }
        }

        stage('Render Helm') {
            steps {
                sh 'helm lint charts/oms-demo'
                sh 'helm template oms-demo charts/oms-demo --set global.imageRegistry=${REGISTRY} --set global.imageTag=${IMAGE_TAG} > rendered.yaml'
                archiveArtifacts artifacts: 'rendered.yaml', fingerprint: true
            }
        }

        stage('Build Images') {
            steps {
                sh '''
                    for service in ${SERVICES}; do
                      docker build \
                        -f services/${service}/Dockerfile \
                        -t ${REGISTRY}/${service}:${IMAGE_TAG} \
                        -t ${REGISTRY}/${service}:latest \
                        .
                    done
                '''
            }
        }

        stage('Scan Images') {
            steps {
                sh '''
                    for service in ${SERVICES}; do
                      trivy image --severity CRITICAL,HIGH --exit-code 1 --ignore-unfixed ${REGISTRY}/${service}:${IMAGE_TAG}
                    done
                '''
            }
        }

        stage('Push Images') {
            steps {
                withCredentials([usernamePassword(credentialsId: 'container-registry-creds', usernameVariable: 'REG_USER', passwordVariable: 'REG_PASS')]) {
                    script {
                        def registryHost = params.REGISTRY.tokenize('/')[0]
                        sh "echo \"\$REG_PASS\" | docker login ${registryHost} -u \"\$REG_USER\" --password-stdin"
                        sh '''
                            for service in ${SERVICES}; do
                              docker push ${REGISTRY}/${service}:${IMAGE_TAG}
                              docker push ${REGISTRY}/${service}:latest
                            done
                        '''
                    }
                }
            }
        }

        stage('Update GitOps Values') {
            when { branch 'main' }
            steps {
                withCredentials([sshUserPrivateKey(credentialsId: 'gitops-ssh-key', keyFileVariable: 'GITOPS_KEY')]) {
                    sh '''
                        mkdir -p ~/.ssh && chmod 700 ~/.ssh
                        cp ${GITOPS_KEY} ~/.ssh/id_rsa && chmod 600 ~/.ssh/id_rsa
                        ssh-keyscan github.com >> ~/.ssh/known_hosts

                        git clone ${GITOPS_REPO} gitops-workspace
                        cd gitops-workspace
                        yq eval ".global.imageRegistry = \"${REGISTRY}\"" -i ${HELM_VALUES_PATH}
                        yq eval ".global.imageTag = \"${IMAGE_TAG}\"" -i ${HELM_VALUES_PATH}

                        git config user.name "jenkins-bot"
                        git config user.email "jenkins-bot@example.com"
                        git add ${HELM_VALUES_PATH}
                        git commit -m "chore(release): deploy oms-demo ${IMAGE_TAG} [skip ci]"
                        git push origin main
                    '''
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'rendered.yaml', allowEmptyArchive: true
        }
    }
}