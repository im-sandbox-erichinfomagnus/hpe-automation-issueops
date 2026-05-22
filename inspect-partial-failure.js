'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { runApprovedExecution } = require('./src/scripts/run-approved-execution');

const githubTeamApi = require('./src/workflow-support/github-team-api');

let callCount = 0;
githubTeamApi.createGitHubTeamApi = () => {
    return {
        addOrUpdateMembershipForUserInOrg: async () => {
            callCount += 1;
            if (callCount === 2) {
                const err = new Error('Unprocessable Entity');
                err.status = 422;
                err.response = { data: { message: 'Validation Failed' } };
                throw err;
            }
            return { status: 200, data: { state: 'active' } };
        },
    };
};

async function run() {
    const artifact = {
        request: {
            organization: 'octo-org',
            team_slug: 'platform-engineering',
            intake_mode: 'bulk_csv',
            requested_people: ['octocat', 'hubot'],
        },
        validation: {
            requested_people: [
                { username: 'octocat', source_row_number: 1, resolution_status: 'resolved', desired_action: 'add_member' },
                { username: 'hubot', source_row_number: 2, resolution_status: 'resolved', desired_action: 'add_member' }
            ]
        },
        reconciliation: {
            people_to_add: [
                { username: 'octocat', source_row_number: 1 },
                { username: 'hubot', source_row_number: 2 }
            ]
        }
    };

    const tempFile = path.join(process.cwd(), 'temp-artifact.json');
    fs.writeFileSync(tempFile, JSON.stringify(artifact));
    process.env.AUDIT_ARTIFACT_PATH = tempFile;

    try {
        await runApprovedExecution();
        const updatedArtifact = JSON.parse(fs.readFileSync(tempFile, 'utf8'));
        
        console.log('validation.requested_people:', JSON.stringify(updatedArtifact.validation.requested_people, null, 2));
        console.log('reconciliation.people_to_add:', JSON.stringify(updatedArtifact.reconciliation.people_to_add, null, 2));
        
        const failedSubset = updatedArtifact.execution && updatedArtifact.execution.failed_subset;
        console.log('execution.failed_subset:', JSON.stringify(failedSubset || [], null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

run();
