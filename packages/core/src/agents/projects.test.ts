import { test } from "node:test";
import assert from "node:assert/strict";
import { projectDeletion } from "./projects.ts";

const general = { id: "general", name: "General" };
const clients = { id: "clients-k3x", name: "Clients" };
const fundraise = { id: "fundraise-a1b", name: "Fundraise" };
const legal = { id: "legal-z9q", name: "Legal" };

test("deleting a project: its meetings go to General, as before, while agents may reach every project", () => {
  assert.deepEqual(projectDeletion([general, clients], "clients-k3x", null, 3), { target: general, agentProjects: null, keepsTarget: false });
  assert.deepEqual(projectDeletion([clients, fundraise], "clients-k3x", null, 3)?.target, fundraise, "no General: the first other one");
  assert.equal(projectDeletion([clients], "clients-k3x", null, 3), null, "nowhere to move them");
});

test("deleting a project agents may reach: General as before, and its id leaves the list", () => {
  assert.deepEqual(projectDeletion([general, clients, fundraise], "fundraise-a1b", ["general", "fundraise-a1b"], 2), { target: general, agentProjects: ["general"], keepsTarget: false });
});

test("deleting a project kept from agents never moves its meetings where agents can reach them", () => {
  // Another kept project takes them, General first when it is kept too.
  assert.deepEqual(projectDeletion([general, clients, legal], "clients-k3x", ["general"], 3), { target: legal, agentProjects: ["general"], keepsTarget: false });
  assert.deepEqual(projectDeletion([general, clients, legal], "clients-k3x", [], 3), { target: general, agentProjects: [], keepsTarget: false });
  // Every other project open to agents: General takes them and is kept from agents too.
  assert.deepEqual(projectDeletion([general, clients, fundraise], "clients-k3x", ["general", "fundraise-a1b"], 3), {
    target: general,
    agentProjects: ["fundraise-a1b"],
    keepsTarget: true,
  });
  // No meetings to move: nothing else changes.
  assert.deepEqual(projectDeletion([general, clients], "clients-k3x", ["general"], 0), { target: general, agentProjects: ["general"], keepsTarget: false });
});
