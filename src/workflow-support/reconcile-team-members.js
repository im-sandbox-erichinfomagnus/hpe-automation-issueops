'use strict';

function normalizeCurrentMember(member) {
  if (typeof member === 'string') {
    return {
      username: member.toLowerCase(),
      state: 'active',
    };
  }

  return {
    username: String(member.username || member.login || '').toLowerCase(),
    state: member.state || 'active',
  };
}

function reconcileTeamMembers(input = {}) {
  const request = input.request || {};
  const validatedPeople = input.validatedPeople || input.requested_people || [];
  const currentMembers = (input.currentMembers || input.current_members || []).map(
    normalizeCurrentMember
  );
  const currentMemberMap = new Map(
    currentMembers.filter((member) => member.username).map((member) => [member.username, member])
  );

  const peopleToAdd = [];
  const peopleAlreadyPresent = [];
  const peopleRejected = [];

  for (const person of validatedPeople) {
    const currentMember = currentMemberMap.get(person.username);
    if (person.resolution_status !== 'resolved') {
      peopleRejected.push({
        ...person,
        desired_action: 'reject',
      });
      continue;
    }

    if (currentMember) {
      peopleAlreadyPresent.push({
        ...person,
        current_membership_state: currentMember.state,
        desired_action: 'noop',
      });
      continue;
    }

    peopleToAdd.push({
      ...person,
      current_membership_state: 'absent',
      desired_action: 'add_member',
    });
  }

  return {
    intake_mode: request.intake_mode || null,
    team_exists: input.team_exists !== false,
    team_sync_blocked: Boolean(input.team_sync_blocked),
    current_members: currentMembers,
    people_to_add: peopleToAdd,
    people_already_present: peopleAlreadyPresent,
    people_rejected: peopleRejected,
    dry_run: Boolean(input.dry_run ?? request.dry_run),
    rate_limit_snapshot: input.rate_limit_snapshot || null,
    state:
      peopleToAdd.length === 0 && peopleRejected.length === 0
        ? 'validated'
        : input.dry_run || request.dry_run
          ? 'validated'
          : 'approved_for_execution',
  };
}

module.exports = {
  reconcileTeamMembers,
};