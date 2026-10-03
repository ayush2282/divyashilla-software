export type Role = 'ADMIN' | 'DELIVERY';
export interface PublicUser {
  id: string; name: string; username: string; role: Role; mustChangePassword: boolean;
}
export interface UserRow {
  id: string; name: string; username: string; role: Role; password_hash: string;
  is_active: boolean; must_change_password: boolean;
}
export interface AuthContext { user: PublicUser; sessionId: string; rawToken: string; expiresAt: Date }
export function publicUser(row: UserRow): PublicUser {
  return {id:row.id,name:row.name,username:row.username,role:row.role,mustChangePassword:row.must_change_password};
}
