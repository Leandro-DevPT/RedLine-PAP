# Deploy numa VPS com HTTPS

O deploy usa Docker Compose para a aplicação e Caddy como proxy HTTPS. O Caddy pede e renova automaticamente os certificados TLS; a API só é acessível na rede interna do Compose. Os dados ficam num volume Docker persistente, separado da imagem.

## Pré-requisitos

- Uma VPS Linux com Docker Engine e o plugin Docker Compose.
- Um domínio com os registos DNS A (e, se usado, AAAA) apontados para a VPS.
- As portas TCP 80 e 443 acessíveis a partir da Internet. A porta UDP 443 é opcional e permite HTTP/3.
- O domínio deve apontar para a VPS antes do primeiro arranque, para o Caddy obter o certificado.

## Inicializar e arrancar

Na raiz do projeto, gera as credenciais uma única vez:

```sh
bash deploy/init-secrets.sh app.exemplo.pt
```

O script cria `.env` com apenas o domínio e dois segredos aleatórios independentes, com permissões restritas. O script recusa substituir uma configuração ou segredos existentes. Não copies os ficheiros gerados para o repositório nem os partilhes.

Arranca os serviços:

```sh
docker compose up --build -d
docker compose ps
curl -fsS https://app.exemplo.pt/api/health
```

O endpoint de saúde deve responder `{"status": "ok"}`. O Caddy redireciona HTTP para HTTPS e acrescenta cabeçalhos de segurança. Guarda os volumes `caddy_data`, `caddy_config` e `app_data`; os dois primeiros contêm o estado dos certificados e o último contém contas e compromissos.

## Executar localmente no Windows

Ao executar o servidor diretamente com Python, os segredos locais são criados automaticamente (uma única vez) em `%LOCALAPPDATA%\Redline\secrets`. No PowerShell, a partir da pasta `src`, basta iniciar:

```powershell
python -m pip install -r .\requirements.txt
python .\main\resources\static\py\server.py
```

O terminal mostra a localização dos ficheiros. A chave da administração local está em `%LOCALAPPDATA%\Redline\secrets\admin_key`; reutiliza esse valor no ecrã de acesso quando necessário. Os ficheiros são reutilizados mesmo que feches o terminal ou reinicies o computador. Não os apagues nem os partilhes.

Depois de criares uma conta no site, digitaliza o QR do segundo fator (ou introduz o segredo manualmente) e promove a conta responsável a administradora. Interrompe o servidor com `Ctrl+C` e executa:

```powershell
python .\main\resources\static\py\manage_users.py promote-admin pessoa@exemplo.pt
```

Confirma a operação e inicia novamente `server.py`. A conta administradora pode então entrar com palavra-passe e segundo fator; as páginas de gestão só ficam disponíveis para uma conta autorizada ou com a chave local. O comando utiliza os mesmos segredos locais guardados em `%LOCALAPPDATA%\Redline\secrets`.

## Primeira conta administradora

Regista a conta normalmente em `https://app.exemplo.pt/register.html`, configura o segundo fator ao digitalizar o QR (ou introduz o segredo manualmente) e confirma o registo. Depois, promove a conta no servidor:

```sh
docker compose exec app python py/manage_users.py promote-admin pessoa@exemplo.pt
```

Confirma a operação no terminal. Depois, inicia sessão com essa conta e o segundo fator antes de abrir a administração. As contas só podem ser promovidas depois de se registarem; esta operação não expõe uma rota pública de criação de administradores.

## Segredos e dados

- `secrets/admin_key` protege o acesso administrativo legado; `secrets/session_secret` assina os tokens de administrador. Em Docker, ambos são obrigatórios, independentes, gerados aleatoriamente e lidos de ficheiros Docker secrets. No Windows local, a aplicação cria ficheiros equivalentes em `%LOCALAPPDATA%\Redline\secrets` quando não são configurados caminhos. Não existem credenciais predefinidas.
- `.env` contém só o domínio. `.env`, `secrets/`, dados JSON e ficheiros temporários/cache estão excluídos do Git ou do contexto de build.
- Os dados JSON existentes na máquina de desenvolvimento não são incluídos na imagem nem copiados automaticamente para a VPS. Migra dados de produção de forma deliberada e através de um canal seguro; faz primeiro uma cópia de segurança do volume.
- Docker Compose monta os segredos como ficheiros apenas de leitura, mas não cifra automaticamente os ficheiros de origem no disco da VPS. Protege o acesso de sistema de ficheiros e as cópias de segurança dessa máquina. Não alteres nem apagues os segredos sem um plano de rotação: isso invalida os tokens administrativos assinados.

Atualiza a aplicação com `docker compose up --build -d`. Para acompanhar o proxy e a obtenção/renovação de certificados, usa `docker compose logs -f caddy`. Mantém Docker e o sistema operativo da VPS atualizados.
