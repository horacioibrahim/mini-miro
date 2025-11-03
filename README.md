# MERGE
OK (MERGE): Carrega o CSV e, para cada linha, faz merge com o que já está salvo no localStorage (chaveando por Demanda normalizada). O que é preservado do localStorage:
tipoEsforco, andamento, progresso, urgencia, observation
parentId, relatedIds, grupo
classificações do step 1 (effortClass, impactClass, abordagemClass, escopoClass, principalImpactClass)
squad e id
O conteúdo bruto do CSV (demanda, demandaDescricao, principalImpacto, obsAdicionais, valores “Raw”) é usado como base. Linhas do CSV sem correspondente no estado viram itens novos; itens que existiam só no localStorage e não estão no CSV deixam de existir após o import (a lista final é a do CSV). No fim, o estado mesclado sobrescreve o localStorage.
Cancelar (ZERAR): Ignora o localStorage durante o import, cria os itens só a partir do CSV (sem herdar edições anteriores), e salva esse novo estado no localStorage.
Resumo prático:
MERGE: mantém suas edições do step 1 e do modal (e.g., tipo de esforço, urgência, grupo, observação, relacionamentos) sempre que houver a mesma Demanda no CSV.
ZERAR: recomeça do CSV “limpo” e descarta o que estava salvo.