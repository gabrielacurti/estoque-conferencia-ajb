# Conferência de Estoque e Reposição: AJ Bengoa

App interno para conferência diária de estoque cruzando vendas de marketplace (Mercado Livre e Shopee) com o saldo do ERP (Tiny), pensado pro fluxo real de separação de pedidos de uma operação de autopeças.

 **Status:** em construção: ajustado conforme o uso real do time mostra o que precisa melhorar.

## O problema

A operação vende por dois marketplaces (~4 mil produtos no Mercado Livre, ~3 mil na Shopee) com cerca de 80 pedidos por dia pra separar, além de venda de balcão e venda de Whatsapp. Antes, a separação era feita numa planilha do Google Sheets aberta no celular: o time separava, e só depois a divergência com o sistema era descoberta: o que gerava revisão duplicada e perda de tempo.

Antes de qualquer coisa ser construída, foi preciso mapear os requisitos reais do processo:

- Produtos vendidos como **"kit"** (ex: um par) consomem estoque de **dois SKUs individuais** diferentes no ERP — se isso não for tratado, a conferência erra silenciosamente.
- Cada marketplace exporta pedido num formato diferente, e parte das vendas do Mercado Livre **entra hoje mas só despacha semanas depois**, misturar isso com a contagem física do dia gera ruído.
- O mesmo produto pode vender nos dois canais no mesmo dia, e o **número do pedido não pode ser contado duas vezes**.

## O que o app faz

- **Importação por canal**: pedidos do Mercado Livre e da Shopee são importados e mapeados separadamente (cada marketplace exporta em formato diferente).
- **Separação por data de despacho**: no Mercado Livre, pedidos com despacho futuro ficam fora da contagem física de hoje, organizados por data.
- **Composição de kits**: produtos vendidos como par/kit são expandidos automaticamente nos SKUs componentes reais, cruzando por SKU ou por descrição.
- **Contagem manual com alerta em tempo real**: cada item mostra o saldo do sistema, o vendido no dia, e um campo de contagem, o app já sinaliza divergência (crítica, pequena, sem saldo) no momento da contagem, sem precisar de revisão depois.
- **Campo de observação** por item, pra registrar contexto (caixa avariada, produto trocado etc.).
- **Sincronização em tempo real** entre dispositivos (Firebase Firestore), o time separa no celular enquanto o progresso é compartilhado.
- **Etapa de Reposição**: lista automática do que veio zerado na contagem.
- **Histórico mensal com gráficos**: produtos mais vendidos por marketplace e produtos com mais divergência ao longo do mês, com opção de apagar dados antigos.

## Como nasceu

Este projeto é o resultado de aplicar, na prática, o mesmo raciocínio que venho estudando em QA: analisar um processo confuso, levantar os requisitos reais (o que precisa ser verdade pra esse processo funcionar), desenhar a solução, e validar, testando caso a caso se ela realmente resolve o que foi pedido.

O levantamento de requisitos, o desenho da lógica de negócio e a validação/teste de cada regra foram feitos por mim. A implementação de código foi construída com apoio de IA (Claude, da Anthropic), sob minha especificação e revisão.

## Stack

- HTML, CSS e JavaScript puro (sem framework/build step)
- [Firebase Firestore](https://firebase.google.com/) — sincronização em tempo real entre dispositivos
- [PapaParse](https://www.papaparse.com/) e [SheetJS/xlsx](https://sheetjs.com/) - leitura de CSV/XLSX no navegador
- Deploy estático via [Netlify](https://www.netlify.com/)

## Rodando localmente

É um único arquivo HTML - basta abrir `index.html` no navegador. A sincronização em tempo real (Firestore) só funciona quando o app está publicado num domínio real, não ao abrir o arquivo direto do disco.

## Screenshots

<!-- Adicionar prints ou GIF mostrando: tela de contagem com alerta de divergência, separação por data de despacho, e o histórico com gráficos -->
