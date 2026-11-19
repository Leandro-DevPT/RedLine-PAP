# Redline Agenda

## Ideia e problema

Pequenos prestadores de serviços — por exemplo, explicadores, profissionais de beleza e técnicos independentes — recebem marcações por telefone, mensagens e redes sociais. A informação fica espalhada, horários podem sobrepor-se e é fácil esquecer quem confirmou, compareceu ou precisa de reagendar.

O Redline Agenda é uma aplicação web simples para gerir clientes e marcações num único lugar. O objetivo é reduzir o trabalho administrativo e dar ao profissional informação prática para organizar a semana.

## Utilizadores

- Profissional independente ou responsável de um pequeno negócio que gere a agenda.

## Funcionalidades principais

- Registar, pesquisar, editar e acompanhar clientes e respetivos contactos.
- Criar marcações com serviço, cliente, data, hora, duração e notas.
- Editar marcações existentes sem perder o histórico do cliente.
- Recusar horários que se sobreponham a outra marcação ativa.
- Atualizar cada marcação como agendada, confirmada, em curso, concluída, cancelada ou falta.
- Consultar um resumo real de hoje, dos próximos sete dias, das faltas e de marcações passadas por atualizar.
- Filtrar a agenda por dia, estado, cliente ou serviço.
- Proteger os dados de gestão com autenticação administrativa.
- Permitir registo e início de sessão apenas a pessoas com 18 anos ou mais.

## Exemplo de utilização

1. O profissional regista uma cliente e o seu contacto.
2. Cria uma sessão de 60 minutos associada à cliente.
3. Se tentar reservar outro serviço durante esse intervalo, a aplicação avisa que existe uma sobreposição.
4. Depois do atendimento, marca-o como concluído ou regista uma falta.
5. O painel atualiza os indicadores e mostra marcações passadas ainda sem resultado.

## Implementação

- Interface responsiva em HTML, CSS e JavaScript.
- API em Python, baseada na biblioteca padrão.
- Persistência em ficheiros JSON, adequada a um protótipo académico e a uma instalação pequena.
- Segredos de administração lidos de ficheiros externos ao código.

## Critérios de avaliação da PAP

- Os registos de clientes e marcações continuam disponíveis depois de atualizar a página ou reiniciar o servidor.
- O sistema rejeita dados obrigatórios inválidos e horários sobrepostos.
- Uma alteração de estado aparece imediatamente na agenda e nos indicadores.
- Utilizadores sem autorização não conseguem consultar os dados de gestão pela API.
- A interface permanece utilizável em ecrãs móveis e apresenta mensagens claras quando o servidor está indisponível.

## Limites e evolução possível

Esta versão não envia SMS ou emails e não processa pagamentos; os lembretes são uma evolução possível, com consentimento do cliente. O armazenamento JSON destina-se a uma demonstração ou pequena instalação de um único negócio, não a vários negócios isolados em produção. Uma evolução futura pode usar uma base de dados, cópias de segurança automáticas, exportação de agenda e lembretes configuráveis.
