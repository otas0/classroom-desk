export type Role = 'student' | 'teacher' | 'admin';

export type AuthUser = {
  id: string;
  role: Role;
  displayName: string;
  username: string | null;
  classId: string | null;
  totalPoints: number;
};

export type DbUser = {
  id: string;
  role: Role;
  display_name: string;
  username: string | null;
  password_hash: string | null;
  class_id: string | null;
  total_points: number;
  created_at: string;
};
