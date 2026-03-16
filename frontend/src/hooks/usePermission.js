import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Known rabbi roles in the system.
 *
 * - 'admin'  : full system access, can manage rabbis and view all data
 * - 'senior' : can answer questions (senior rabbi), access discussions and templates
 * - 'rabbi'  : standard rabbi, can answer questions assigned to them
 */
const ROLES = {
  ADMIN: 'admin',
  SENIOR: 'senior',
  RABBI: 'rabbi',
};

/**
 * usePermission — derives permission flags from the authenticated rabbi's role.
 *
 * All flags are memoized and recomputed only when the rabbi object changes.
 *
 * @returns {{
 *   role:          string | null,
 *   isAdmin:       boolean,   — full admin access
 *   isSenior:      boolean,   — senior rabbi (can also answer)
 *   isRabbi:       boolean,   — any rabbi role (admin | senior | rabbi)
 *   canAnswer:     boolean,   — allowed to write and publish answers
 *   canViewAdmin:  boolean,   — allowed to see the /admin route
 *   canManageRabbis: boolean, — allowed to add/edit/deactivate rabbis
 *   canViewAuditLog: boolean, — allowed to view the audit log
 *   isVacation:    boolean,   — rabbi's vacation mode flag
 *   isActive:      boolean,   — rabbi account is active (not deactivated)
 * }}
 *
 * Usage:
 *   const { isAdmin, canAnswer } = usePermission();
 *
 *   if (!canAnswer) return <AccessDenied />;
 */
function usePermission() {
  const { rabbi, isAdmin: authIsAdmin, isSenior: authIsSenior } = useAuth();

  return useMemo(() => {
    if (!rabbi) {
      return {
        role: null,
        isAdmin: false,
        isSenior: false,
        isRabbi: false,
        canAnswer: false,
        canViewAdmin: false,
        canManageRabbis: false,
        canViewAuditLog: false,
        isVacation: false,
        isActive: false,
      };
    }

    // Derive role from the rabbi object.
    // AuthContext already exposes isAdmin / isSenior, but we re-derive here
    // so this hook is self-contained and consistent.
    const role = rabbi.role ?? null;
    const isAdmin = role === ROLES.ADMIN || rabbi.isAdmin === true || authIsAdmin;
    const isSenior = role === ROLES.SENIOR || rabbi.isSenior === true || authIsSenior;
    const isRabbi = isAdmin || isSenior || role === ROLES.RABBI;

    // Permission matrix
    const canAnswer = isRabbi;               // all valid rabbi roles can write answers
    const canViewAdmin = isAdmin;            // only admins see the /admin section
    const canManageRabbis = isAdmin;         // only admins add/edit rabbis
    const canViewAuditLog = isAdmin;         // only admins can read audit logs

    const isVacation = rabbi.is_vacation === true;
    const isActive = rabbi.is_active !== false; // default to true if field missing

    return {
      role,
      isAdmin,
      isSenior,
      isRabbi,
      canAnswer,
      canViewAdmin,
      canManageRabbis,
      canViewAuditLog,
      isVacation,
      isActive,
    };
  }, [rabbi, authIsAdmin, authIsSenior]);
}

export default usePermission;
