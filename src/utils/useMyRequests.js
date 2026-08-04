// MP-CORRECTIONS-GUARDRAIL — the CURRENT staffer's own approval requests.
//
// A shared hook, not a second useQuery, deliberately. The ["my-requests"] key is now
// read from TWO places (the My Requests page and the nav badge), and this codebase has
// already been bitten twice by one react-query key with two unwrap shapes — once on
// ["locations"], once on ["my-permissions"], where the page that fetched last decided
// the cache shape and the other silently read undefined. See utils/useMyPermissions.js
// for the same fix applied to the same class of bug.
//
// ALWAYS returns the INNER array.
import { useQuery } from "@tanstack/react-query";
import api from "./api";

export const MY_REQUESTS_KEY = ["my-requests"];

export function useMyRequests({ enabled = true, refetchInterval = 30000 } = {}) {
  const q = useQuery({
    queryKey: MY_REQUESTS_KEY,
    // The ONE canonical unwrap.
    queryFn: () => api.get("/staff/my-requests").then((r) => r.data?.data || []),
    enabled,
    refetchInterval,
  });
  const requests = q.data || [];
  // APPROVED = the owner gave the green light and NOTHING HAS HAPPENED YET. On this
  // rail approval never executes; the requester must finalize. These are the rows that
  // used to be invisible — the boss thought the job was done, the staffer had moved on,
  // and a corrected float quietly stayed wrong until the shift closed on it.
  const awaitingCompletion = requests.filter((r) => r && r.status === "approved");
  return { requests, awaitingCompletion, ...q };
}

export default useMyRequests;
