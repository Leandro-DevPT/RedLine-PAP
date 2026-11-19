"""Administrative account provisioning for the Redline deployment."""
import argparse
import sys

from server import read_users, write_users


def main():
    parser = argparse.ArgumentParser(description="Promove uma conta existente a administrador.")
    parser.add_argument("action", choices=("promote-admin",))
    parser.add_argument("email")
    arguments = parser.parse_args()

    email = arguments.email.strip().lower()
    users = read_users()
    if email not in users:
        print(f"Não existe uma conta com o email {email}.", file=sys.stderr)
        return 1
    if users[email].get("role") == "admin":
        print(f"A conta {email} já é administradora.")
        return 0
    if input(f"Promover {email} a administradora? [s/N] ").strip().lower() != "s":
        print("Operação cancelada.")
        return 1

    users[email]["role"] = "admin"
    write_users(users)
    print(f"Conta {email} promovida a administradora.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
