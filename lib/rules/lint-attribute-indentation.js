'use strict';

const Rule = require('./base');
const createErrorMessage = require('../helpers/create-error-message');

const getWhiteSpaceLength = function(statement) {
  let whiteSpace = statement.match(/^\s+/) || [];
  return (whiteSpace[0] || '').length;
};

function getEndLocationForOpen(node) {
  if (node.type === 'BlockStatement') {
    /*
      For a block statement, the start of the program block is the end of the open invocation.

      {{#contact-details firstName=firstName lastName=lastName as |contact|}}
        {{contact.fullName}}
      {{/contact-details}}
    */

    return node.program.loc.start;
  } else if (node.type === 'ElementNode' && node.children.length > 0) {
    return node.children[0].loc.start;
  } else {
    return node.loc.end;
  }
}

const canApplyRule = function(node, type, config) {
  let end = getEndLocationForOpen(node);
  let start = node.loc.start;

  if (start.line === end.line) {
    return (end.column - start.column)  > config.maxLength;
  }

  return true;
};


module.exports = class AttributeSpacing extends Rule {

  getBlockParamStartLoc(node) {
    let actual, expected;
    let programStartLoc = node.program.loc.start;
    let nodeStart = node.loc.start;
    if (node.params.length === 0 && node.hash.pairs.length === 0) {
      expected = {
        line: nodeStart.line + 1,
        column: nodeStart.column
      };
      if (nodeStart.line === programStartLoc.line) {
        let displayName = `{{#${node.path.original}`;
        /*
        {{#employee-details as |employee|}}
          {{employee.name}}
        {{/employee-details}}
        */
        actual = {
          line: nodeStart.line,
          column: displayName.length
        };
      } else {
        /*
        {{#employee-details
          as |employee|}}
          {{employee.name}}
        {{/employee-details}}
        */
        let source = this.sourceForNode({
          loc: {
            start: {
              line: programStartLoc.line,
              /*
                Setting column as 0, to get the entire line for calculating the start column.
                For instance, the below will result in `                    as |employee|}}` => 19
                  `{{#employee-details
                                      as |employee|}}
                    {{employee.name}}
                  {{/employee-details}}
                  `
              */
              column: 0
            },
            end: programStartLoc
          }
        });
        //
        /*
          Determining the actual column by calculating the whitespace length
            `{{#employee-details
                                as |employee|}} => 19
              {{employee.name}}
            {{/employee-details}}`
        */
        actual = {
          line: programStartLoc.line,
          column: getWhiteSpaceLength(source)
        };
      }

    } else {
      let paramOrHashPairEndLoc;

      if (node.params.length) {
        /*
        The block form may contain only positional params as below
        {{#employee-details
          firstName
          lastName
          age
        as |employee|}}
          {{employee.fullName}}
        {{/employee-details}}
        */
        paramOrHashPairEndLoc = node.params[node.params.length - 1].loc.end;
      }

      if (node.hash.pairs.length) {
        /*
        The block form may contain only named params as below
        {{#employee-details
          firstName=firstName
          lastName=lastName
          age=age
        as |employee|}}
          {{employee.fullName}}
        {{/employee-details}}
        */
        paramOrHashPairEndLoc = node.hash.loc.end;
      }

      expected = {
        line: paramOrHashPairEndLoc.line + 1,
        column: node.loc.start.column
      };
      if (paramOrHashPairEndLoc.line === programStartLoc.line) {
        /*
        {{#employee-details
          employeeId=employeeId as |employee|}}
          {{employee.name}}
        {{/employee-details}}
        */
        actual = paramOrHashPairEndLoc;
      } else if (paramOrHashPairEndLoc.line < programStartLoc.line) {
        /*
        {{#employee-details
          employeeId=employeeId
        as |employee|}}
          {{employee.name}}
        {{/employee-details}}
        */

        /*
        Since the below scenario is possible, we are getting the source of params/hash pair line.

        {{#employee-details
          id=id as |employee
          address|}}
          {{employee.name}}
        {{/employee-details}}
        */

        let loc = {
          start: paramOrHashPairEndLoc,
          end: {
            line: paramOrHashPairEndLoc.line
          }
        };

        let hashPairLineEndSource = this.sourceForNode({ loc }).trim();

        if (hashPairLineEndSource) {
          /*
          {{#employee-details
            id=id as |employee
            address|}}
            {{employee.name}}
          {{/employee-details}}
          */
          actual = paramOrHashPairEndLoc;
        } else {
          /*
          {{#employee-details
            id=id
                  as |employee address|}}
            {{employee.name}}
          {{/employee-details}}
          */
          actual = {
            line: programStartLoc.line,
            column: getWhiteSpaceLength(this.source[programStartLoc.line - 1])
          };
        }
      }
    }
    return {
      actual,
      expected
    };
  }

  validateBlockParams(node) {
    /*
      Validates alignment of the block params.

      {{#employee-details
        employeeId=employeeId
      as |name age address|}}
        {{name}}, {{age}}, {{address}}
      {{/employee-details}}
    */

    let location = this.getBlockParamStartLoc(node);
    let actual = location.actual;
    let expected = location.expected;

    if (actual.line !== expected.line ||
      actual.column !== expected.column) {

      let blockParamStatement = this.sourceForNode({ loc: { start: actual, end: node.program.loc.start } }).trim();

      let message = `Incorrect indentation of block params '${blockParamStatement}' beginning at L${actual.line}:C${actual.column}. Expecting the block params to be at L${expected.line}:C${expected.column}.`;

      this.log({
        message,
        line: actual.line,
        column: actual.column,
        source: this.sourceForNode(node)
      });
    }
  }

  iterateParams(params, type, expectedLineStart, expectedColumnStart, node) {
    let paramType, namePath;

    if (type === 'positional') {
      paramType = 'positional param';
      namePath = 'original';
      if (node.path.loc.source === '(synthetic)') {
        expectedLineStart--;
        if (node.type === 'BlockStatement') {
          node.params[0].loc.start.column--;
        }
      }
    } else if (type === 'htmlAttribute') {
      paramType = 'htmlAttribute';
      namePath = 'name';
    } else {
      paramType = 'attribute';
      namePath = 'key';
    }

    params.forEach((param) => {
      let actualStartLocation = param.loc.start;
      if (expectedLineStart !== actualStartLocation.line ||
        expectedColumnStart !== actualStartLocation.column) {
        let paramName = param[namePath] ? param[namePath] : param.path.original;
        let message = `Incorrect indentation of ${paramType} '${paramName}' beginning at L${actualStartLocation.line}:C${actualStartLocation.column}. Expected '${paramName}' to be at L${expectedLineStart}:C${expectedColumnStart}.`;
        this.log({
          message,
          line: actualStartLocation.line,
          column: actualStartLocation.column,
          source: this.sourceForNode(node)
        });
      }

      const type = param.value ? param.value.type : param.type;
      if (type === 'SubExpression') {
        //TODO check subexpressions
        if (param.loc.start.line !== param.loc.end.line) {
          expectedLineStart = param.loc.end.line;
        }
      } else if (type === 'MustacheStatement') {
        expectedLineStart = param.value.loc.end.line;
      }

      expectedLineStart++;
    });
    return expectedLineStart;
  }

  validateParams (node) {
    /*
        Validates both the positional and named params for both block and non-block form.

        {{contact-details
          age
          firstName=firstName
          fullName=fullName
        }}
    */
    let expectedColumnStart = node.loc.start.column + this.config.indentation; //params should be after proper positions from component start node
    let expectedLineStart = node.loc.start.line + 1;

    if (node.type === 'ElementNode') {
      expectedLineStart = this.iterateParams(node.attributes, 'htmlAttribute', expectedLineStart, expectedColumnStart, node);
    } else {
      expectedLineStart = this.iterateParams(node.params, 'positional', expectedLineStart, expectedColumnStart, node);
      expectedLineStart = this.iterateParams(node.hash.pairs, 'attribute', expectedLineStart, expectedColumnStart, node);
    }

    return expectedLineStart;
  }

  validateCloseBrace(node, expectedStartLine) {
    /*
      Validates the close brace `}}` for Handlebars and `>` for HTML/SVG elements of the non-block form.
    */
    let end = getEndLocationForOpen(node);
    const actualColumnStartLocation = node.type === 'ElementNode' && !node.selfClosing ? 1 : 2;
    const actualStartLocation = {
      line: end.line,
      column: end.column - actualColumnStartLocation
    };

    const expectedStartLocation = {
      line: expectedStartLine,
      column: node.loc.start.column
    };

    let componentName = node.type === 'ElementNode' ? node.tag : node.path.original;
    if (actualStartLocation.line !== expectedStartLocation.line ||
      actualStartLocation.column !== expectedStartLocation.column) {
      let message = `Incorrect indentation of close curly braces '}}' for the component '{{${componentName}}}' beginning at L${actualStartLocation.line}:C${actualStartLocation.column}. Expected '{{${componentName}}}' to be at L${expectedStartLocation.line}:C${expectedStartLocation.column}.`;
      if (node.type === 'ElementNode') {
        message = `Incorrect indentation of close bracket '>' for the element '<${componentName}>' beginning at L${actualStartLocation.line}:C${actualStartLocation.column}. Expected '<${componentName}>' to be at L${expectedStartLocation.line}:C${expectedStartLocation.column}.`;
      }

      this.log({
        message,
        line: actualStartLocation.line,
        column: actualStartLocation.column,
        source: this.sourceForNode(node)
      });
    }

  }

  validateClosingTag(node, expectedStartLine) {
    /*
      Validates the closing tag (`</tag>`) of the block form.
    */
    const actualColumnStartLocation = 3 + node.tag.length;
    const actualStartLocation = {
      line: node.loc.end.line,
      column: node.loc.end.column - actualColumnStartLocation
    };

    const expectedStartLocation = {
      line: expectedStartLine,
      column: node.loc.start.column
    };

    let tagName = node.type === 'ElementNode' ? node.tag : node.path.original;
    if (actualStartLocation.line !== expectedStartLocation.line ||
      actualStartLocation.column !== expectedStartLocation.column) {
      let message = `Incorrect indentation of close tag '</${tagName}>' for element '<${tagName}>' beginning at L${actualStartLocation.line}:C${actualStartLocation.column}. Expected '</${tagName}>' to be at L${expectedStartLocation.line}:C${expectedStartLocation.column}.`;

      this.log({
        message,
        line: actualStartLocation.line,
        column: actualStartLocation.column,
        source: this.sourceForNode(node)
      });
    }

  }

  validateNonBlockForm(node) {
    // no need to validate if no positional and named params are present.
    if (node.params.length || node.hash.pairs.length) {
      const expectedStartLine = this.validateParams(node);
      this.validateCloseBrace(node, expectedStartLine);
      return expectedStartLine;
    }
  }

  validateBlockForm(node) {
    if (node.params.length || node.hash.pairs.length) {
      this.validateParams(node);
    }
    if (node.program.blockParams && node.program.blockParams.length) {
      this.validateBlockParams(node);
    }
  }

  parseConfig(config) {
    let configType = typeof config;

    switch (configType) {
    case 'boolean':
      if (config) {
        return {
          maxLength: 80,
          indentation: 2,
          processElements: true,
        };
      }
      return false;
    case 'object': {
      let result = {
        maxLength: 80,
        indentation: 2,
      };
      if ('open-invocation-max-len' in config) {
        result.maxLength = config['open-invocation-max-len'];
      }
      if ('indentation' in config) {
        result.indentation = config.indentation;
      }
      if ('process-elements' in config) {
        result.processElements = config['process-elements'];
      }
      return result;
    }
    case 'undefined':
      return false;
    }

    let errorMessage = createErrorMessage(this.ruleName, [
      '  * boolean - `true` - Enables the rule to be enforced when the opening invocation has more than 80 characters or when it spans multiple lines.',
      '  * { open-invocation-max-len: n characters, indentation: m  } - n : The max length of the opening invocation can be configured',
      '  *                                                            - m : The desired indentation of attribute',
      '  * { process-elements: `boolean` }                         - `true` : Also parse HTML/SVG attributes'
    ], config);

    throw new Error(errorMessage);
  }

  visitor() {

    return {
      BlockStatement(node) {
        if (canApplyRule(node, node.type, this.config)) {
          this.validateBlockForm(node);
        }
      },
      MustacheStatement(node) {
        if (canApplyRule(node, node.type, this.config)) {
          return this.validateNonBlockForm(node);
        }
        return node.loc.end.line;
      },
      ElementNode(node) {
        if (this.config.processElements) {
          if (canApplyRule(node, node.type, this.config)) {
            if (node.attributes.length) {
              let expectedCloseBraceLine = this.validateParams(node);
              this.validateCloseBrace(node, expectedCloseBraceLine);
            }

            if (node.children.length) {
              const lastChild = node.children[node.children.length - 1];
              const expectedStartLine = lastChild.type === 'BlockStatement' ? lastChild.loc.end.line + 1 : lastChild.loc.end.line;
              this.validateClosingTag(node, expectedStartLine);
            }
          }
          return node.loc.end.line;
        }
      }
    };
  }
};
