# Before finishing a user-facing change

Applies to any change a passenger can see or use: the Follow view, the map, the ride-along, the
bus card, wording and states. It adds to `AGENTS.md` and `CLAUDE.md` and does not repeat them.

1. **Review the main passenger journeys yourself**, as a passenger would, not only through the
   checks written with the change: find a stop, see what is coming, choose a bus, follow it, ride
   along, browse the alternatives and come back to it, reload, and open a shared link.
2. **Check each of these:**
   - selection continuity: the chosen bus stays chosen through new reports, list reordering,
     filters, camera gestures, theme changes and temporary absence, and nothing is substituted;
   - clarity: one message per situation, with a useful next action;
   - readability: labels and controls unobstructed in 2D, City, Outside and Front views, on phone
     and desktop, by day and by night;
   - keyboard and touch access;
   - camera behaviour;
   - loading, empty, stale and offline states;
   - performance.
3. **Implement the improvements this needs within scope.** Propose substantial new features
   separately rather than adding them.
4. **Record each requirement** as one of:
   - **implemented and verified**, naming the check;
   - **implemented but unverified**, saying what would verify it;
   - **blocked**, with the specific reason.
5. **A passing test count alone does not establish a good experience.** Look at the frames, and say
   whether each piece of evidence is from the real feed, a recording, a fixture or a physical phone.
6. **Keep engineering-opportunity entries evidence-based** (the rules in `CLAUDE.md`), and say
   whether each is a fix in this repository or a potential reusable tool.
