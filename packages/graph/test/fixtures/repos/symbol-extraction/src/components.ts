// React-like component (PascalCase arrow function)
export const UserCard = (props: { name: string; age: number }) => {
  return `User: ${props.name}, Age: ${props.age}`;
};

export const AdminPanel = () => {
  return "Admin Panel";
};

// Regular function component
export function Header() {
  return "Header";
}

// Not a component (camelCase)
export const useAuth = () => {
  return { isLoggedIn: false };
};
