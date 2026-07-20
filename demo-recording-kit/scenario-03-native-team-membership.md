# Scenario 3: Native Team Membership

This scenario uses GitHub's normal team UI, not an IssueOps issue.

1. Open `https://github.com/orgs/im-sandbox-erichinfomagnus/teams/ericdemo-repo-admin/members`.
2. Show that `adamg-infomagnus` is a maintainer. This was established by scenario 2.
3. Click Add a member.
4. Add `KalpanaReddyC` as a member.
5. Refresh the members page and record the new active membership.

Also open `https://github.com/orgs/im-sandbox-erichinfomagnus/teams/ericdemo-cicd-admin/members` and show that the tenant admin can manage that child team too.

## Rejection Clip

The exact GitHub rejection requires a second account that is only a team member. Sign in as `KalpanaReddyC`, reopen the RepoAdmin members page, and record that GitHub does not provide team membership administration to a non-maintainer. Do not change Adam's maintainer role. Keep `aeruvakalpanaa` out of this team for the later IssueOps rejection clips.
