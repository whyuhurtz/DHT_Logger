"""
DHT Logger Setup Script
Version: 0.1.4

Usage:
  python setup.py --deploy docker    # Deploy using Docker Compose
  python setup.py --deploy manual    # Deploy manually (venv + uvicorn)
  python setup.py --clean            # Clean Docker deployment

Requirements:
  - Python 3.8+
  - Docker (for --deploy docker and --clean)
  - MySQL DBMS (for --deploy manual)
"""

import sys
import platform
import subprocess
import shutil
from pathlib import Path

# =====================================================
# ANSI Color Codes for Terminal Output
# =====================================================
class Colors:
  HEADER = '\033[95m'
  OKBLUE = '\033[94m'
  OKCYAN = '\033[96m'
  OKGREEN = '\033[92m'
  WARNING = '\033[93m'
  FAIL = '\033[91m'
  ENDC = '\033[0m'
  BOLD = '\033[1m'
  UNDERLINE = '\033[4m'

def print_info(msg: str):
  """Print info message"""
  print(f"{Colors.OKCYAN}[INFO]{Colors.ENDC} {msg}")

def print_success(msg: str):
  """Print success message"""
  print(f"{Colors.OKGREEN}[SUCCESS]{Colors.ENDC} {msg}")

def print_error(msg: str):
  """Print error message"""
  print(f"{Colors.FAIL}[ERROR]{Colors.ENDC} {msg}")

def print_warning(msg: str):
  """Print warning message"""
  print(f"{Colors.WARNING}[WARNING]{Colors.ENDC} {msg}")

def print_header(msg: str):
  """Print header message"""
  print(f"\n{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}")
  print(f"{Colors.HEADER}{Colors.BOLD}{msg.center(60)}{Colors.ENDC}")
  print(f"{Colors.HEADER}{Colors.BOLD}{'='*60}{Colors.ENDC}\n")

# =====================================================
# Helper Functions
# =====================================================

def run_command(cmd: list, cwd: str | None = None, shell: bool = False) -> bool:
  """
  Run shell command and return success status
  
  Args:
    cmd: Command as list of strings
    cwd: Working directory
    shell: Use shell execution
  
  Returns:
    True if command succeeded, False otherwise
  """
  try:
    print_info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(
      cmd,
      cwd=cwd,
      shell=shell,
      check=True,
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,
      text=True,
      encoding='utf-8', # Fix error decoding output
      errors='replace'  # Replace invalid chars with ?
    )
    if result.stdout:
      print(result.stdout)
    return True
  except subprocess.CalledProcessError as e:
    print_error(f"Command failed: {e}")
    if e.stderr:
      print(e.stderr)
    return False
  except FileNotFoundError:
    print_error(f"Command not found: {cmd[0]}")
    return False

def check_docker_installed() -> bool:
  """Check if Docker is installed"""
  try:
    subprocess.run(
      ["docker", "--version"],
      check=True,
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE
    )
    return True
  except (subprocess.CalledProcessError, FileNotFoundError):
    return False

def check_python_version() -> bool:
  """Check if Python version is 3.8+"""
  version = sys.version_info
  if version.major >= 3 and version.minor >= 8:
    return True
  return False

def get_web_dir() -> Path:
  """Get web directory path"""
  return Path(__file__).parent / "web"

def get_venv_activate_script() -> str:
  """Get virtual environment activation script based on OS"""
  system = platform.system()
  web_dir = get_web_dir()
  
  if system == "Windows":
    return str(web_dir / ".venv" / "Scripts" / "activate.bat")
  else:  # Linux/Mac
    return str(web_dir / ".venv" / "bin" / "activate")

# =====================================================
# Deployment Functions
# =====================================================

def deploy_docker():
  """Deploy using Docker Compose"""
  print_header("🐳 DOCKER DEPLOYMENT")
  
  # Check Docker installation
  if not check_docker_installed():
    print_error("Docker is not installed!")
    print_info("Please install Docker Desktop: https://www.docker.com/products/docker-desktop")
    return False
  
  print_success("✅ Docker is installed")
  
  # Navigate to web directory
  web_dir = get_web_dir()
  if not web_dir.exists():
    print_error(f"Web directory not found: {web_dir}")
    return False
  
  print_info(f"📂 Working directory: {web_dir}")
  
  # Check if .env file exists
  env_file = web_dir / ".env"
  if not env_file.exists():
    print_warning("⚠️ .env file not found")
    print_info("Copying .env.example to .env...")
    
    env_example = web_dir / ".env.example"
    if env_example.exists():
      shutil.copy(env_example, env_file)
      print_success("✅ .env file created. Please configure it before running.")
    else:
      print_error("❌ .env.example not found!")
      return False
  
  # Check if emqxsl-ca.crt exists
  ca_cert = web_dir / "emqxsl-ca.crt"
  if not ca_cert.exists():
    print_warning("⚠️ emqxsl-ca.crt not found")
    print_info("Copying emqxsl-ca.crt.example...")
    
    ca_cert_example = web_dir / "emqxsl-ca.crt.example"
    if ca_cert_example.exists():
      shutil.copy(ca_cert_example, ca_cert)
      print_success("✅ CA certificate created")
    else:
      print_error("❌ emqxsl-ca.crt.example not found!")
      return False
  
  # Run docker compose
  print_info("🚀 Starting Docker Compose...")
  success = run_command(
    ["docker", "compose", "up", "--build", "-d"],
    cwd=str(web_dir)
  )
  
  if success:
    print_success("✅ Docker deployment successful!")
    print_info("📊 Access dashboard at: http://localhost:1337")
    return True
  else:
    print_error("❌ Docker deployment failed!")
    return False

def deploy_manual():
  """Deploy manually (venv + uvicorn)"""
  print_header("🐍 MANUAL DEPLOYMENT")
  
  # Check Python version
  if not check_python_version():
    print_error("Python 3.8+ is required!")
    print_info(f"Current version: {sys.version}")
    return False
  
  print_success(f"✅ Python {sys.version_info.major}.{sys.version_info.minor} detected")
  
  # Navigate to web directory
  web_dir = get_web_dir()
  if not web_dir.exists():
    print_error(f"Web directory not found: {web_dir}")
    return False
  
  print_info(f"📂 Working directory: {web_dir}")
  
  # Check if .env file exists
  env_file = web_dir / ".env"
  if not env_file.exists():
    print_warning("⚠️ .env file not found")
    print_info("Copying .env.example to .env...")
    
    env_example = web_dir / ".env.example"
    if env_example.exists():
      shutil.copy(env_example, env_file)
      print_success("✅ .env file created")
      print_warning("⚠️ Please configure .env file before running!")
    else:
      print_error("❌ .env.example not found!")
      return False
  
  # Check if emqxsl-ca.crt exists
  ca_cert = web_dir / "emqxsl-ca.crt"
  if not ca_cert.exists():
    print_warning("⚠️ emqxsl-ca.crt not found")
    print_info("Copying emqxsl-ca.crt.example...")
    
    ca_cert_example = web_dir / "emqxsl-ca.crt.example"
    if ca_cert_example.exists():
      shutil.copy(ca_cert_example, ca_cert)
      print_success("✅ CA certificate created")
    else:
      print_error("❌ emqxsl-ca.crt.example not found!")
      return False
  
  # Create virtual environment
  venv_dir = web_dir / ".venv"
  if not venv_dir.exists():
    print_info("📦 Creating virtual environment...")
    success = run_command(
      [sys.executable, "-m", "venv", ".venv"],
      cwd=str(web_dir)
    )
    if not success:
      print_error("❌ Failed to create virtual environment!")
      return False
    print_success("✅ Virtual environment created")
  else:
    print_info("📦 Virtual environment already exists")
  
  # Determine pip command based on OS
  system = platform.system()
  if system == "Windows":
    pip_cmd = str(venv_dir / "Scripts" / "pip.exe")
    python_cmd = str(venv_dir / "Scripts" / "python.exe")
  else:  # Linux/Mac
    pip_cmd = str(venv_dir / "bin" / "pip")
    python_cmd = str(venv_dir / "bin" / "python")
  
  # Install dependencies
  requirements_file = web_dir / "requirements-prod.txt"
  if not requirements_file.exists():
    print_error(f"❌ requirements-prod.txt not found: {requirements_file}")
    return False
  
  print_info("📥 Installing dependencies from requirements-prod.txt...")
  success = run_command(
    [pip_cmd, "install", "-r", "requirements-prod.txt", "--no-cache-dir"],
    cwd=str(web_dir)
  )
  
  if not success:
    print_error("❌ Failed to install dependencies!")
    return False
  
  print_success("✅ Dependencies installed successfully")
  
  print_success("\n✅ Manual deployment setup complete!")
  print_warning("\n⚠️ IMPORTANT: Make sure MySQL database is running!")
  print_info("\n📋 To start the application, run:")
  
  if system == "Windows":
    print(f"{Colors.OKBLUE}cd web{Colors.ENDC}")
    print(f"{Colors.OKBLUE}.\\.venv\\Scripts\\activate.bat{Colors.ENDC}")  # ← FIX: Double backslash
    print(f"{Colors.OKBLUE}uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload{Colors.ENDC}")
  else:  # Linux/Mac
    print(f"{Colors.OKBLUE}cd web{Colors.ENDC}")
    print(f"{Colors.OKBLUE}source .venv/bin/activate{Colors.ENDC}")
    print(f"{Colors.OKBLUE}uvicorn src.main:app --host 127.0.0.1 --port 8000 --reload{Colors.ENDC}")

  print_info("\n📊 Access dashboard at: http://127.0.0.1:8000")
  
  return True

def clean_docker():
  """Clean Docker deployment"""
  print_header("🧹 CLEANING DOCKER DEPLOYMENT")
  
  # Check Docker installation
  if not check_docker_installed():
    print_error("Docker is not installed!")
    return False
  
  web_dir = get_web_dir()
  if not web_dir.exists():
    print_error(f"Web directory not found: {web_dir}")
    return False
  
  print_info(f"📂 Working directory: {web_dir}")
  
  # Stop and remove containers + volumes
  print_info("🛑 Stopping containers and removing volumes...")
  success1 = run_command(
    ["docker", "compose", "down", "-v"],
    cwd=str(web_dir)
  )
  
  # Remove Docker image
  print_info("🗑️ Removing Docker image...")
  success2 = run_command(
    ["docker", "image", "rm", "-f", "fastapi_dht:v0.1.4"],
    cwd=str(web_dir)
  )
  
  if success1 and success2:
    print_success("✅ Docker cleanup successful!")
    return True
  else:
    print_warning("⚠️ Some cleanup steps failed (this might be normal if containers/images don't exist)")
    return True

# =====================================================
# Main Function
# =====================================================

def print_usage():
  """Print usage instructions"""
  print(f"\n{Colors.HEADER}{Colors.BOLD}DHT Logger Setup Script v0.1.4{Colors.ENDC}")
  print(f"{Colors.BOLD}Usage:{Colors.ENDC}")
  print(f"  python setup.py --deploy docker    # Deploy using Docker Compose")
  print(f"  python setup.py --deploy manual    # Deploy manually (venv + uvicorn)")
  print(f"  python setup.py --clean            # Clean Docker deployment\n")
  print(f"{Colors.BOLD}Examples:{Colors.ENDC}")
  print(f"  python setup.py --deploy docker")
  print(f"  python setup.py --deploy manual")
  print(f"  python setup.py --clean\n")

def main():
  """Main entry point"""
  if len(sys.argv) < 2:
    print_error("❌ Missing arguments!")
    print_usage()
    sys.exit(1)
  
  command = sys.argv[1]
  
  if command == "--deploy":
    if len(sys.argv) < 3:
      print_error("❌ Missing deployment type!")
      print_usage()
      sys.exit(1)
    
    deploy_type = sys.argv[2].lower()
    
    if deploy_type == "docker":
      success = deploy_docker()
    elif deploy_type == "manual":
      success = deploy_manual()
    else:
      print_error(f"❌ Invalid deployment type: {deploy_type}")
      print_usage()
      sys.exit(1)
  
    sys.exit(0 if success else 1)
  
  elif command == "--clean":
    success = clean_docker()
    sys.exit(0 if success else 1)
  
  else:
    print_error(f"❌ Invalid command: {command}")
    print_usage()
    sys.exit(1)

if __name__ == "__main__":
  main()