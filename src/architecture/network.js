let _ = require(`lodash`);
let parameter = require(`../util/parameter`);
var multi = require(`../multithreading/multi`);
var methods = require(`../methods/methods`);
var Connection = require(`./connection`);
var config = require(`../config`);
var Node = require(`./node`);

// Easier variable naming
const mutation = methods.mutation;


/**
* Create a neural network
*
* Networks are easy to create, all you need to specify is an `input` and an `output` size.
*
* @constructs Network
*
* @param {number} input_size Size of input layer AKA neurons in input layer
* @param {number} output_size Size of output layer AKA neurons in output layer
*
* @prop {number} input_size Size of input layer AKA neurons in input layer
* @prop {number} output_size Size of output layer AKA neurons in output layer
* @prop {number} dropout [Dropout rate](https://medium.com/@amarbudhiraja/https-medium-com-amarbudhiraja-learning-less-to-learn-better-dropout-in-deep-machine-learning-74334da4bfc5) likelihood for any given neuron to be ignored during network training. Must be between zero and one, numbers closer to one will result in more neurons ignored.
* @prop {Array<Node>} nodes Nodes currently within the network
* @prop {Array<Node>} gates Gates within the network
* @prop {Array<Connection>} connections Connections within the network
* @prop {Array<Connection>} selfconns Self-connections within the network
*
* @example
* let { Network, architect } = require("@liquid-carrot/carrot");
*
* // Network with 2 input neurons and 1 output neuron
* let myNetwork = new Network(2, 1);
*
* // and a multi-layered network
* let myNetwork = new architect.Perceptron(5, 20, 10, 5, 1);
*/
function Network(input_size, output_size) {
  if (typeof input_size === `undefined` || typeof output_size === `undefined`) {
    throw new Error(`No input or output size given`);
  }
  // *IDEA*: Store input & output nodes in arrays accessible by this.input and this.output instead of just storing the number
  this.input_size = input_size;
  this.output_size = output_size;
  // backwards compatibility
  this.input = input_size;
  this.output = output_size;

  // Store all the node and connection genes
  this.nodes = []; // Stored in activation order
  this.connections = [];
  this.gates = [];
  this.selfconns = [];

  // Regularization
  this.dropout = 0;

  // Create input and output nodes
  var i;
  for (i = 0; i < this.input_size + this.output_size; i++) {
    var type = i < this.input_size ? `input` : `output`;
    this.nodes.push(new Node(type));
  }

  // Connect input nodes with output nodes directly
  for (i = 0; i < this.input_size; i++) {
    for (var j = this.input_size; j < this.output_size + this.input_size; j++) {
      // https://stats.stackexchange.com/a/248040/147931
      var weight = Math.random() * this.input_size * Math.sqrt(2 / this.input_size);
      this.connect(this.nodes[i], this.nodes[j], weight);
    }
  }
}

Network.prototype = {
  /**
   * Activates the network
   *
   * It will activate all the nodes in activation order and produce an output.
   *
   * @param {number[]} [input] Input values to activate nodes with
   * @param {boolean} training Used to toggle [dropout](https://medium.com/@amarbudhiraja/https-medium-com-amarbudhiraja-learning-less-to-learn-better-dropout-in-deep-machine-learning-74334da4bfc5)
   *
   * @returns {number[]} Squashed output values
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * // Create a network
   * let myNetwork = new Network(3, 2);
   *
   * myNetwork.activate([0.8, 1, 0.21]); // gives: [0.49, 0.51]
   */
  activate: function activate(input, training) {
    const output = [];

    // Activate nodes chronologically
    this.nodes.forEach((node, node_index) => {
      if (node.type === `input`) {
        node.activate(input[node_index]);
      } else if (node.type === `output`) {
        const activation_result = node.activate();
        output.push(activation_result);
      } else {
        if (training) node.mask = Math.random() < this.dropout ? 0 : 1;
        node.activate();
      }
    });

    return output;
  },

  /**
   * Activates the network without calculating elegibility traces and such
   *
   * @param {number[]} input An array of input values equal in size to the input layer
   *
   * @returns {number[]} output An array of output values equal in size to the output layer
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * // Create a network
   * let myNetwork = new Network(3, 2);
   *
   * myNetwork.no_trace_activate([0.8, 1, 0.21]); // gives: [0.49, 0.51]
   */
  no_trace_activate: function no_trace_activate(input) {
    const output = [];

    // Activate nodes chronologically for forward feeding
    this.nodes.forEach((node, node_index) => {
      if (node.type === `input`) {
        node.no_trace_activate(input[node_index]);
      } else if (node.type === `output`) {
        const activation_result = node.no_trace_activate();
        output.push(activation_result);
      } else {
        node.no_trace_activate();
      }
    });

    return output;
  },

  /**
   * Backpropagate the network
   *
   * This function allows you to teach the network. If you want to do more complex training, use the `network.train()` function.
   *
   * @param {number} rate=0.3 Sets the [learning rate](https://towardsdatascience.com/understanding-learning-rates-and-how-it-improves-performance-in-deep-learning-d0d4059c1c10) of the backpropagation process
   * @param {number} momentum=0 [Momentum](https://www.willamette.edu/~gorr/classes/cs449/momrate.html). Adds a fraction of the previous weight update to the current one.
   * @param {boolean} update=false When set to false weights won't update, but when set to true after being false the last propagation will include the deltaweights of the first "update:false" propagations too.
   * @param {number[]} target Ideal values of the previous activate. Will use the difference to improve the weights
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * let myNetwork = new Network(1,1);
   *
   * // This trains the network to function as a NOT gate
   * for(var node_index = 0; i < 1000; i++){
   *  network.activate([0]);
   *  network.propagate(0.2, 0, true, [1]);
   *  network.activate([1]);
   *  network.propagate(0.3, 0, true, [0]);
   * }
   */
  propagate: function propagate(rate, momentum, update, target) {
    // the or in the if is for backward compatibility
    const output_size = (this.output_size || this.output);
    const input_size = (this.input_size || this.input);
    if (typeof target === `undefined` || target.length !== output_size) {
      throw new Error(`Output target length should match network output length`);
    }

    // index used to iterate through the target array when updating
    let target_index = target.length;

    // propagate output nodes
    let i;
    for (i = this.nodes.length - 1; i >= this.nodes.length - output_size; i--) {
      this.nodes[i].propagate(target[--target_index], { rate, momentum, update });
    }

    // Propagate hidden and input nodes
    for (i = this.nodes.length - output_size - 1; i >= input_size; i--) {
      this.nodes[i].propagate({ rate, momentum, update });
    }
  },

  /**
   * Clear the context of the network
   */
  clear: function clear() {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].clear();
    }
  },

  /**
   * Returns a new identical network
   *
   * @returns {Network} Returns an identical network
   */
  clone: function clone() {
    const self = this;

    return new Network(self.input, self.output);
  },

  /**
   * Connects a Node to another Node or Group in the network
   *
   * @param {Node} from The source Node
   * @param {Node|Group} to The destination Node or Group
   * @param {number} weight An initial weight for the connections to be formed
   *
   * @returns {Connection[]} An array of the formed connections
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * myNetwork.connect(myNetwork.nodes[4], myNetwork.nodes[5]); // connects network node 4 to network node 5
   */
  connect: function connect(from, to, weight) {
    // many elements if dealing with groups for example
    let connections = from.connect(to, weight);

    for (let i = 0; i < connections.length; i++) {
      let connection = connections[i];
      if (from !== to) {
        this.connections.push(connection);
      } else {
        this.selfconns.push(connection);
      }
    }

    return connections;
  },

  /**
   * Removes the connection of the `from` node to the `to` node
   *
   * @param {Node} from Source node
   * @param {Node} to Destination node
   *
   * @example
   * myNetwork.disconnect(myNetwork.nodes[4], myNetwork.nodes[5]);
   * // now node 4 does not have an effect on the output of node 5 anymore
   */
  disconnect: function disconnect(from, to) {
    // Delete the connection in the network's connection array
    const connections = from === to ? this.selfconns : this.connections;

    for (let i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.from === from && connection.to === to) {
        if (connection.gater !== null) this.ungate(connection);
        connections.splice(i, 1);
        break;
      }
    }

    // Delete the connection at the sending and receiving neuron
    from.disconnect(to);
  },

  /**
   * Makes a network node gate a connection
   *
   * @todo Add ability to gate several network connections at once
   *
   * @param {Node} node Gating node
   * @param {Connection} connection Connection to gate with node
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * myNetwork.gate(myNetwork.nodes[1], myNetwork.connections[5])
   * // now: connection 5's weight is multiplied with node 1's activaton
   */
  gate: function gate(node, connection) {
    if (this.nodes.indexOf(node) === -1) {
      throw new Error(`This node is not part of the network!`);
    } else if (connection.gater != null) {
      if (config.warnings) console.warn(`This connection is already gated!`);
      return;
    }
    node.gate(connection);
    this.gates.push(connection);
  },

  /**
   * Remove the gate of a connection.
   *
   * @param {Connection} connection Connection to remove gate from
   *
   * @example
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * let myNetwork = new architect.Perceptron(1, 4, 2);
   *
   * // Gate a connection
   * myNetwork.gate(myNetwork.nodes[2], myNetwork.connections[5]);
   *
   * // Remove the gate from the connection
   * myNetwork.ungate(myNetwork.connections[5]);
   */
  ungate: function ungate(connection) {
    const index = this.gates.indexOf(connection);
    if (index === -1) {
      throw new Error(`This connection is not gated!`);
    }

    this.gates.splice(index, 1);
    connection.gater.ungate(connection);
  },

  /**
   * Removes a node from a network, all its connections will be redirected. If it gates a connection, the gate will be removed.
   *
   * @param {Node} node Node to remove from the network
   *
   * @example
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * let myNetwork = new architect.Perceptron(1,4,1);
   *
   * // Remove a node
   * myNetwork.remove(myNetwork.nodes[2]);
   */
  remove: function remove(node) {
    const index = this.nodes.indexOf(node);

    if (index === -1) {
      throw new Error(`This node does not exist in the network!`);
    }

    // Keep track of gates
    const gates = [];

    // Remove selfconnections from this.selfconns
    this.disconnect(node, node);

    // Get all its inputting nodes
    const inputs = [];
    // unsure why not regular forEach
    _.forEachRight(node.connections.in, (connection) => {
      if (mutation.SUB_NODE.keep_gates && connection.gater !== null && connection.gater !== node) {
        gates.push(connection.gater);
      }
      inputs.push(connection.from);
      this.disconnect(connection.from, node);
    });


    // Get all its outputing nodes
    const outputs = [];
    // unsure why not regular forEach
    _.forEachRight(node.connections.out, (connection) => {
      if (mutation.SUB_NODE.keep_gates && connection.gater !== null && connection.gater !== node) {
        gates.push(connection.gater);
      }
      outputs.push(connection.to);
      this.disconnect(node, connection.to);
    });

    // Connect the input nodes to the output nodes (if not already connected)
    const connections = [];
    _.forEach(inputs, (input) => {
      _.forEach(outputs, (output) => {
        if (!input.isProjectingTo(output)) {
          const connection = this.connect(input, output);
          connections.push(connection[0]);
        }
      });
    });

    // Gate random connections with gates
    // finish after all gates have been placed again or all connections are gated
    while (gates.length > 0 && connections.length > 0) {
      const gate = gates.shift();
      const connection_to_gate_index = Math.floor(Math.random() * connections.length);

      this.gate(gate, connections[connection_to_gate_index]);
      connections.splice(connection_to_gate_index, 1);
    }

    // Remove gated connections gated by this node
    for (i = node.connections.gated.length - 1; i >= 0; i--) {
      let conn = node.connections.gated[i];
      this.ungate(conn);
    }

    // Remove selfconnection
    this.disconnect(node, node);

    // Remove the node from this.nodes
    this.nodes.splice(index, 1);
  },

  /**
   * Checks whether a given mutation is possible, returns an array of candidates to use for a mutation when it is.
   *
   * @param {mutation} method [Mutation method](mutation)
   *
   * @returns {false | object[]} candidates to use for a mutation. Entries may be arrays containing paris when appropriate.
   *
   * @example
   *
   * const network = new architect.Perceptron(2,3,1)
   *
   * network.possible(mutation.SUB_NODE) // returns an array of nodes that can be removed
   */
  possible: function mutationIsPossible(method) {
    const self = this
    let candidates = []
    switch (method) {
      case mutation.SUB_NODE:
        candidates = _.filter(this.nodes, function(node) { return (node.type !== `output` && node.type !== `input`) }) // assumes input & output node 'type' has been set
        return candidates.length ? candidates : false
      case mutation.ADD_CONN:
        for (let i = 0; i < this.nodes.length - this.output_size; i++) {
          const node1 = this.nodes[i]
          for (let j = Math.max(i + 1, this.input_size); j < this.nodes.length; j++) {
            const node2 = this.nodes[j]
            if (!node1.isProjectingTo(node2)) candidates.push([node1, node2])
          }
        }

        return candidates.length ? candidates : false
      case mutation.SUB_CONN:
        _.each(self.connections, (conn) => {
          // Check if it is not disabling a node
          if (conn.from.connections.out.length > 1 && conn.to.connections.in.length > 1 && self.nodes.indexOf(conn.to) > self.nodes.indexOf(conn.from))
            candidates.push(conn)
        })

        return candidates.length ? candidates : false
      case mutation.MOD_ACTIVATION: return (method.mutateOutput || this.nodes.length > this.input_size + this.output_size) ? [] : false
      case mutation.ADD_SELF_CONN:

        for (let i = this.input_size; i < this.nodes.length; i++) {
          const node = this.nodes[i]
          if (node.connections.self.weight === 0) candidates.push(node)
        }

        return candidates.length ? candidates : false
      case mutation.SUB_SELF_CONN: return (this.selfconns.length > 0) ? [] : false
      case mutation.ADD_GATE:
        const allconnections = this.connections.concat(this.selfconns);

        _.each(allconnections, (conn) => { if(conn.gater === null) candidates.push(conn) })

        return candidates.length ? candidates : false
      case mutation.SUB_GATE: return (this.gates.length > 0) ? [] : false
      case mutation.ADD_BACK_CONN:
        for (let i = this.input_size; i < this.nodes.length; i++) {
          const node1 = this.nodes[i]
          for (let j = this.input_size; j < i; j++) {
            const node2 = this.nodes[j]
            if (!node1.isProjectingTo(node2)) candidates.push([node1, node2])
          }
        }

        return candidates.length ? candidates : false
      case mutation.SUB_BACK_CONN:
        _.each(self.connections, (conn) => {
          if (conn.from.connections.out.length > 1 && conn.to.connections.in.length > 1 && self.nodes.indexOf(conn.from) > self.nodes.indexOf(conn.to))
            candidates.push(conn)
        })

        return candidates.length ? candidates : false
      case mutation.SWAP_NODES:
        // break out early if there aren't enough nodes to swap
        if((this.nodes.length - 1) - this.input_size - (method.mutateOutput ? 0 : this.output_size) < 2) return false;

        const filterFn = (method.mutateOutput) ? (node) => (node.type !== `input`) : (node) => (node.type !== `input` && node.type !== `output`)

        candidates = _.filter(this.nodes, filterFn)

        // Check there are at least two possible nodes
        return (candidates.length >= 2) ? candidates : false
    }
  },

  /**
   * Mutates the network with the given method
   *
   * @param {mutation} method [Mutation method](mutation)
   *
   * @returns {boolean} Whether or not a mutation was achieved
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * myNetwork.mutate(mutation.ADD_GATE) // a random node will gate a random connection within the network
   */
  mutate: function mutate(method) {
    if (typeof method === `undefined`) throw new Error(`No (correct) mutate method given!`);

    var i, j;
    switch (method) {
      case mutation.ADD_NODE: {
        // Look for an existing connection and place a node in between
        const connection = this.connections[Math.floor(Math.random() * this.connections.length)];
        this.disconnect(connection.from, connection.to);

        // Insert the new node right before the old connection.to
        const toIndex = this.nodes.indexOf(connection.to);
        const node = new Node(`hidden`);

        if(mutation.ADD_NODE.randomActivation) node.mutate(mutation.MOD_ACTIVATION);

        // Place it in this.nodes
        const minBound = Math.min(toIndex, this.nodes.length - this.output_size);
        this.nodes.splice(minBound, 0, node);

        // Now create two new connections
        const newConn1 = this.connect(connection.from, node)[0];
        const newConn2 = this.connect(node, connection.to)[0];

        const gater = connection.gater;
        // Check if the original connection was gated
        if (gater != null) this.gate(gater, Math.random() >= 0.5 ? newConn1 : newConn2);

        break;
      }
      case mutation.SUB_NODE: {
        const possible = this.possible(method)
        if(possible) this.remove(_.sample(possible));

        break
      }
      case mutation.ADD_CONN: {
        const possible = this.possible(method)
        if(possible) {
          const pair = possible[Math.floor(Math.random() * possible.length)];
          this.connect(pair[0], pair[1]);
        }

        break
      }
      case mutation.SUB_CONN: {
        const possible = this.possible(method)
        if(possible) {
          const randomConn = possible[Math.floor(Math.random() * possible.length)];
          this.disconnect(randomConn.from, randomConn.to);
        }

        break
      }
      case mutation.MOD_WEIGHT: {
        const allconnections = this.connections.concat(this.selfconns);
        const connection = allconnections[Math.floor(Math.random() * allconnections.length)];

        connection.weight += Math.random() * (method.max - method.min) + method.min;

        break;
      }
      case mutation.MOD_BIAS: {
        // Has no effect on input nodes, so they (should be) excluded, TODO -- remove this ordered array of: input, output, hidden nodes assumption...
        this.nodes[Math.floor(Math.random() * (this.nodes.length - this.input_size) + this.input_size)].mutate(method);

        break;
      }
      case mutation.MOD_ACTIVATION:{
        if(this.possible(method)) {
          const possible = _.filter(this.nodes, method.mutateOutput ? (node) => node.type !== `input` : (node) => node.type !== `input` && node.type !== `output`);

          // Mutate a random node out of the filtered collection
          _.sample(possible).mutate(method);
        }
        break;
      }
      case mutation.ADD_SELF_CONN: {
        const possible = this.possible(method)
        if(possible) {
          const node = possible[Math.floor(Math.random() * possible.length)];
          this.connect(node, node); // Create the self-connection
        }

        break
      }
      case mutation.SUB_SELF_CONN: {
        if(this.possible(method)) {
          const conn = this.selfconns[Math.floor(Math.random() * this.selfconns.length)];
          this.disconnect(conn.from, conn.to);
        }

        break
      }
      case mutation.ADD_GATE: {
        const possible = this.possible(method)
        if(possible) {
          // Select a random gater node and connection, can't be gated by input
          const node = this.nodes[Math.floor(Math.random() * (this.nodes.length - this.input_size) + this.input_size)];
          const conn = possible[Math.floor(Math.random() * possible.length)];

          this.gate(node, conn); // Gate the connection with the node
        }

        break
      }
      case mutation.SUB_GATE: {
        if(this.possible(method)) this.ungate(this.gates[Math.floor(Math.random() * this.gates.length)])

        break
      }
      case mutation.ADD_BACK_CONN: {
        const possible = this.possible(method)
        if(possible) {
          const pair = possible[Math.floor(Math.random() * possible.length)];
          this.connect(pair[0], pair[1]);
        }

        break;
      }
      case mutation.SUB_BACK_CONN:{
        const possible = this.possible(method)
        if(possible) {
          const randomConn = possible[Math.floor(Math.random() * possible.length)];
          this.disconnect(randomConn.from, randomConn.to);
        }

        break;
      }
      case mutation.SWAP_NODES: {
        const possible = this.possible(method)
        if(possible) {
          // Return a random node out of the filtered collection
          const node1 = _.sample(possible)

          // Filter node1 from collection
          const possible2 = _.filter(possible, function(node, index) { return (node !== node1) })

          // Get random node from filtered collection (excludes node1)
          const node2 = _.sample(possible2)

          const biasTemp = node1.bias;
          const squashTemp = node1.squash;

          node1.bias = node2.bias;
          node1.squash = node2.squash;
          node2.bias = biasTemp;
          node2.squash = squashTemp;
        }

        break;
      }
    }
  },

  /**
   * Train the given data to this network
   *
   * @param {Array<{input:number[],output:number[]}>} data A data of input values and ideal output values to train the network with
   * @param {Object} options Options used to train network
   * @param {options.cost} [options.cost=options.cost.MSE] The [options.cost function](https://en.wikipedia.org/wiki/Loss_function) used to determine network error
   * @param {rate} [options.rate_policy=rate.FIXED] A [learning rate policy](https://towardsdatascience.com/understanding-learning-rates-and-how-it-improves-performance-in-deep-learning-d0d4059c1c10), i.e. how to change the learning rate during training to get better network performance
   * @param {number} [options.rate=0.3] Sets the [learning rate](https://towardsdatascience.com/understanding-learning-rates-and-how-it-improves-performance-in-deep-learning-d0d4059c1c10) of the backpropagation process
   * @param {number} [options.iterations=1000] Sets amount of training cycles the process will maximally run, even when the target error has not been reached.
   * @param {number} [options.error] The target error to train for, once the network falls below this error, the process is stopped. Lower error rates require more training cycles.
   * @param {number} [options.dropout=0] [Dropout rate](https://medium.com/@amarbudhiraja/https-medium-com-amarbudhiraja-learning-less-to-learn-better-options.dropout-in-deep-machine-learning-74334da4bfc5) likelihood for any given neuron to be ignored during network training. Must be between zero and one, numbers closer to one will result in more neurons ignored.
   * @param {number} [options.momentum=0] [Momentum](https://www.willamette.edu/~gorr/classes/cs449/momrate.html). Adds a fraction of the previous weight update to the current one.
   * @param {number} [options.batch_size=1] Sets the (mini-) batch size of your training. Default: 1 [(online training)](https://www.quora.com/What-is-the-difference-between-batch-online-and-mini-batch-training-in-neural-networks-Which-one-should-I-use-for-a-small-to-medium-sized-dataset-for-prediction-purposes)
   * @param {number} [options.cross_validate.testSize] Sets the amount of test cases that should be assigned to cross validation. If data to 0.4, 40% of the given data will be used for cross validation.
   * @param {number} [options.cross_validate.test_error] Sets the target error of the validation data.
   * @param {boolean} [options.clear=false] If data to true, will clear the network after every activation. This is useful for training LSTM's, more importantly for timeseries prediction.
   * @param {boolean} [options.shuffle=false] When data to true, will shuffle the training data every iteration_number. Good option to use if the network is performing worse in [cross validation](https://artint.info/html/ArtInt_189.html) than in the real training data.
   * @param {number|boolean} [options.log=false] If data to n, outputs training status every n iterations. Setting `log` to 1 will log the status every iteration_number
   * @param {number} [options.schedule.iterations] You can schedule tasks to happen every n iterations. Paired with `options.schedule.function`
   * @param {schedule} [options.schedule.function] A function to run every n iterations as data by `options.schedule.iterations`. Passed as an object with a "function" property that contains the function to run.
   *
   * @returns {{error:{number},iterations:{number},time:{number}}} A summary object of the network's performance
   *
   * @example <caption>Training with Defaults</caption>
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * let network = new architect.Perceptron(2,4,1);
   *
   * // Train the XOR gate
   * network.train([{ input: [0,0], output: [0] },
   *                { input: [0,1], output: [1] },
   *                { input: [1,0], output: [1] },
   *                { input: [1,1], output: [0] }]);
   *
   * network.activate([0,1]); // 0.9824...
   *
   * @example <caption>Training with Options</caption>
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * let network = new architect.Perceptron(2,4,1);
   *
   * let trainingSet = [
   *    { input: [0,0], output: [0] },
   *    { input: [0,1], output: [1] },
   *    { input: [1,0], output: [1] },
   *    { input: [1,1], output: [0] }
   * ];
   *
   * // Train the XNOR gate
   * network.train(trainingSet, {
   *    log: 1,
   *    iterations: 1000,
   *    error: 0.0001,
   *    rate: 0.2
   * });
   *
   * @example <caption>Cross Validation Example</caption>
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * let network = new architect.Perceptron(2,4,1);
   *
   * let trainingSet = [ // PS: don't use cross validation for small sets, this is just an example
   *  { input: [0,0], output: [1] },
   *  { input: [0,1], output: [0] },
   *  { input: [1,0], output: [0] },
   *  { input: [1,1], output: [1] }
   * ];
   *
   * // Train the XNOR gate
   * network.train(trainingSet, {
   *  crossValidate:
   *    {
   *      testSize: 0.4,
   *      test_error: 0.02
   *    }
   * });
   *
   */
  train: function train(data, options) {
    // the or in the size is for backward compatibility
    if (data[0].input.length !== (this.input_size || this.input) || data[0].output.length !== (this.output_size || this.output)) {
      throw new Error(`Dataset input/output size should be same as network input/output size!`);
    }

    // Warning messages
    if (config.warnings && options) {
      if (typeof options.rate === `undefined`) {
        console.warn(`Using default learning rate, please define a rate!`);
      }
      if (typeof options.iterations === `undefined`) {
        console.warn(`No target iterations given, running until error is reached!`);
      }
    }

    // backwards compatibility
    if (options) {
      options = _.defaults(options, {
        batch_size: options.batchSize,
        rate_policy: options.ratePolicy,
        cross_validate: options.crossValidate
      });
    }

    // data defaults and read the options
    options = _.defaults(options, {
      iterations: 1000,
      error: 0.05,
      cost: methods.cost.MSE,
      rate: 0.3,
      dropout: 0,
      momentum: 0,
      batch_size: 1, // online learning
      rate_policy: methods.rate.FIXED()
    });

    // if cross validation is data, target error might be higher than crossValidate.test_error,
    // so if CV is data then also data target error to crossvalidate error
    let target_error;
    if (options.cross_validate) {
      target_error = options.cross_validate.test_error;
    } else if (options.error) {
      target_error = options.error;
    } else {
      target_error = -1; // run until iterations
    }
    const base_training_rate = options.rate;

    const start = Date.now();

    // check for errors
    if (options.batch_size > data.length) {
      throw new Error(`Batch size must be smaller or equal to dataset length!`);
    } else if (typeof options.iterations === `undefined` && typeof options.error === `undefined`) {
      throw new Error(`At least one of the following options must be specified: error, iterations`);
    } else if (typeof options.iterations === `undefined`) {
      options.iterations = 0; // run until target error
    }

    // Save to network
    this.dropout = options.dropout;

    let training_set_size, train_set, test_set;
    if (options.cross_validate) {
      training_set_size = Math.ceil((1 - options.cross_validate.testSize) * data.length);
      train_set = data.slice(0, training_set_size);
      test_set = data.slice(training_set_size);
    } else {
      train_set = data;
    }

    // Loops the training process
    let current_training_rate = base_training_rate;
    let iteration_number = 0;
    let error = 1;

    var i, j, x;
    while (error > target_error && (options.iterations === 0 ||
      iteration_number < options.iterations)) {
      iteration_number++;

      // Update the rate
      current_training_rate = options.rate_policy(base_training_rate, iteration_number);

      // run on training epoch
      const train_error = this._train_one_epoch(
        train_set, options.batch_size, current_training_rate, options.momentum, options.cost);
      if (options.clear) this.clear();
      // Checks if cross validation is enabled
      if (options.cross_validate) {
        error = this.test(test_set, options.cost).error;
        if (options.clear) this.clear();
      } else {
        error = train_error;
      }

      // Checks for options such as scheduled logs and shuffling
      if (options.shuffle) {
        // just a horrible shuffle - black magic ahead (not that bad but looks like witchery)
        for (j, x, i = data.length; i;
          j = Math.floor(Math.random() * i), x = data[--i], data[i] = data[j], data[j] = x);
      }

      if (options.log && iteration_number % options.log === 0) {
        console.log(`iteration number`, iteration_number,
          `error`, error, `training rate`, current_training_rate);
      }

      if (options.schedule && iteration_number % options.schedule.iterations === 0) {
        options.schedule.function({ error: error, iteration_number: iteration_number });
      }
    }

    if (options.clear) this.clear();

    if (options.dropout) {
      for (i = 0; i < this.nodes.length; i++) {
        if (this.nodes[i].type === `hidden` || this.nodes[i].type === `constant`) {
          this.nodes[i].mask = 1 - this.dropout;
        }
      }
    }

    return {
      error: error,
      iterations: iteration_number,
      time: Date.now() - start
    };
  },

  /**
   * Performs one training epoch and returns the error - this is a private function used in `this.train`
   *
   * @todo Add `@param` tag descriptions
   * @todo Add `@returns` tag description
   *
   * @private
   *
   * @param {Array<{input:number[], output: number[]}>} set
   * @param {number} batch_size
   * @param {number} current_training_rate
   * @param {number} momentum
   * @param {cost} cost_function
   *
   * @returns {number}
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * let example = ""
   */
  _train_one_epoch: function _train_one_epoch(set, batch_size, training_rate, momentum, cost_function) {
    let error_sum = 0;
    for (var i = 0; i < set.length; i++) {
      const input = set[i].input;
      const correct_output = set[i].output;

      // the !! turns to boolean
      const update = !!((i + 1) % batch_size === 0 || (i + 1) === set.length);

      const output = this.activate(input, true);
      this.propagate(training_rate, momentum, update, correct_output);

      error_sum += cost_function(correct_output, output);
    }
    return error_sum / set.length;
  },

  /**
   * Tests a set and returns the error and elapsed time
   *
   * @param {Array<{input:number[],output:number[]}>} set A set of input values and ideal output values to test the network against
   * @param {cost} [cost=methods.cost.MSE] The [cost function](https://en.wikipedia.org/wiki/Loss_function) used to determine network error
   *
   * @returns {{error:{number},time:{number}}} A summary object of the network's performance
   *
   */
  test: function test(set, cost = methods.cost.MSE) {
    // Check if dropout is enabled, set correct mask
    if (this.dropout) {
      _.times(this.nodes.length, (index) => {
        if (this.nodes[index].type === `hidden` || this.nodes[index].type === `constant`) {
          this.nodes[index].mask = 1 - this.dropout;
        }
      });
    }

    let error = 0;
    let start = Date.now();

    _.times(set.length, (index) => {
      let input = set[index].input;
      let target = set[index].output;
      let output = this.no_trace_activate(input);
      error += cost(target, output);
    });

    error /= set.length;

    const results = {
      error: error,
      time: Date.now() - start
    };

    return results;
  },

  /**
   * Creates a json that can be used to create a graph with d3 and webcola
   *
   * @param {number} width Width of the graph
   * @param {number} height Height of the graph
   *
   * @returns {{nodes:Array<{id:{number},name:{string},activation:{activation},bias:{number}}>,links:Array<{{source:{number},target:{number},weight:{number},gate:{boolean}}}>,constraints:{Array<{type:{string},axis:{string},offsets:{node:{number},offset:{number}}}>}}}
   *
   */
  graph: function graph(width, height) {
    let input = 0;
    let output = 0;

    var graph_json = {
      nodes: [],
      links: [],
      constraints: [{
        type: `alignment`,
        axis: `x`,
        offsets: []
      }, {
        type: `alignment`,
        axis: `y`,
        offsets: []
      }]
    };

    let i;
    for (i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];

      if (node.type === `input`) {
        if (this.input_size === 1) {
          graph_json.constraints[0].offsets.push({
            node: i,
            offset: 0
          });
        } else {
          graph_json.constraints[0].offsets.push({
            node: i,
            offset: 0.8 * width / (this.input_size - 1) * input++
          });
        }
        graph_json.constraints[1].offsets.push({
          node: i,
          offset: 0
        });
      } else if (node.type === `output`) {
        if (this.output_size === 1) {
          graph_json.constraints[0].offsets.push({
            node: i,
            offset: 0
          });
        } else {
          graph_json.constraints[0].offsets.push({
            node: i,
            offset: 0.8 * width / (this.output_size - 1) * output++
          });
        }
        graph_json.constraints[1].offsets.push({
          node: i,
          offset: -0.8 * height
        });
      }

      graph_json.nodes.push({
        id: i,
        name: node.type === `hidden` ? node.squash.name : node.type.toUpperCase(),
        activation: node.activation,
        bias: node.bias
      });
    }

    const connections = this.connections.concat(this.selfconns);
    for (i = 0; i < connections.length; i++) {
      const connection = connections[i];
      if (connection.gater == null) {
        graph_json.links.push({
          source: this.nodes.indexOf(connection.from),
          target: this.nodes.indexOf(connection.to),
          weight: connection.weight
        });
      } else {
        // Add a gater 'node'
        const index = graph_json.nodes.length;
        graph_json.nodes.push({
          id: index,
          activation: connection.gater.activation,
          name: `GATE`
        });
        graph_json.links.push({
          source: this.nodes.indexOf(connection.from),
          target: index,
          weight: 1 / 2 * connection.weight
        });
        graph_json.links.push({
          source: index,
          target: this.nodes.indexOf(connection.to),
          weight: 1 / 2 * connection.weight
        });
        graph_json.links.push({
          source: this.nodes.indexOf(connection.gater),
          target: index,
          weight: connection.gater.activation,
          gate: true
        });
      }
    }

    return graph_json;
  },

  /**
   * Convert the network to a json object
   *
   * @returns {{node:{object},connections:{object},input_size:{number},output_size:{number},dropout:{number}}} The network represented as a json object
   *
   * @example
   * let { Network } = require("@liquid-carrot/carrot");
   *
   * let exported = myNetwork.to_JSON();
   * let imported = Network.from_JSON(exported) // imported will be a new instance of Network that is an exact clone of myNetwork
   */
  to_JSON: function to_JSON() {
    const json = {
      nodes: [],
      connections: [],
      input_size: this.input_size,
      output_size: this.output_size,
      dropout: this.dropout,
      // backward compatibility
      input: this.input_size,
      output: this.output_size,
    };

    // So we don't have to use expensive .indexOf()
    let i;
    for (i = 0; i < this.nodes.length; i++) {
      this.nodes[i].index = i;
    }

    for (i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      const node_json = node.to_JSON();
      node_json.index = i;
      json.nodes.push(node_json);

      if (node.connections.self.weight !== 0) {
        const connection_json = node.connections.self.to_JSON();
        connection_json.from = i;
        connection_json.to = i;

        connection_json.gater = node.connections.self.gater != null ? node.connections.self.gater.index : null;
        json.connections.push(connection_json);
      }
    }

    for (i = 0; i < this.connections.length; i++) {
      const connection = this.connections[i];
      const connection_json = connection.to_JSON();
      connection_json.from = connection.from.index;
      connection_json.to = connection.to.index;

      connection_json.gater = connection.gater != null ? connection.gater.index : null;

      json.connections.push(connection_json);
    }

    return json;
  },

  /**
   * For backward compatibility
   */
  toJSON: Network.prototype.to_JSON,

  /**
   * Sets the value of a property for every node in this network
   *
   * @param {number} values.bias Bias to set for all network nodes
   * @param {activation} values.squash [Activation function](https://medium.com/the-theory-of-everything/understanding-activation-functions-in-neural-networks-9491262884e0) to set for all network nodes
   *
   * @example
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * var network = new architect.Random(4, 4, 1);
   *
   * // All nodes in 'network' now have a bias of 1
   * network.set({bias: 1});
   */
  set: function set(values) {
    this.nodes = _.forEach(this.nodes, (node) => _.defaults(node, {
      bias: values.bias,
      squash: values.squash
    }));
  },

  /**
   * Evolves the network to reach a lower error on a dataset using the [NEAT algorithm](http://nn.cs.utexas.edu/downloads/papers/stanley.ec02.pdf)
   *
   * If both `iterations` and `error` options are unset, evolve will default to `iterations` as an end condition.
   *
   * @param {Array<{input:number[],output:number[]}>} set A set of input values and ideal output values to train the network with
   * @param {object} [options] Configuration options
   * @param {number} [options.iterations=1000] Set the maximum amount of iterations/generations for the algorithm to run.
   * @param {number} [options.error=0.05] Set the target error. The algorithm will stop once this target error has been reached.
   * @param {number} [options.growth=0.0001] Set the penalty for large networks. Penalty calculation: penalty = (genome.nodes.length + genome.connectoins.length + genome.gates.length) * growth; This penalty will get added on top of the error. Your growth should be a very small number.
   * @param {cost} [options.cost=cost.MSE]  Specify the cost function for the evolution, this tells a genome in the population how well it's performing. Default: methods.cost.MSE (recommended).
   * @param {number} [options.amount=1] Set the amount of times to test the trainingset on a genome each generation. Useful for timeseries. Do not use for regular feedfoward problems.
   * @param {number} [options.threads] Specify the amount of threads to use. Default value is the amount of cores in your CPU.
   * @param {Network} [options.network]
   * @param {number|boolean} [options.log=false] If set to n, outputs training status every n iterations. Setting `log` to 1 will log the status every iteration
   * @param {number} [options.schedule.iterations] You can schedule tasks to happen every n iterations. Paired with `options.schedule.function`
   * @param {schedule} [options.schedule.function] A function to run every n iterations as set by `options.schedule.iterations`. Passed as an object with a "function" property that contains the function to run.
   * @param {boolean} [options.clear=false] If set to true, will clear the network after every activation. This is useful for evolving recurrent networks, more importantly for timeseries prediction.
   * @param {boolean} [options.equal=true] If set to true when [Network.cross_over](Network.cross_over) runs it will assume both genomes are equally fit.
   * @param {number} [options.popsize=50] Population size of each generation.
   * @param {number} [options.elitism=1] Elitism of every evolution loop. [Elitism in genetic algorithms.](https://www.researchgate.net/post/What_is_meant_by_the_term_Elitism_in_the_Genetic_Algorithm)
   * @param {number} [options.provenance=0] Number of genomes inserted the original network template (Network(input,output)) per evolution.
   * @param {number} [options.mutationRate=0.4] Sets the mutation rate. If set to 0.3, 30% of the new population will be mutated. Default is 0.3.
   * @param {number} [options.mutationAmount=1] If mutation occurs (randomNumber < mutationRate), sets amount of times a mutation method will be applied to the network.
   * @param {boolean} [options.fitnessPopulation=false] Flag to return the fitness of a population of genomes. Set this to false to evaluate each genome individually.
   * @param {Function} [options.fitness] - A fitness function to evaluate the networks. Takes a `genome`, i.e. a [network](Network), and a `dataset` and sets the genome's score property
   * @param {string} [options.selection=FITNESS_PROPORTIONATE] [Selection method](selection) for evolution (e.g. methods.Selection.FITNESS_PROPORTIONATE).
   * @param {Array} [options.crossover] Sets allowed crossover methods for evolution.
   * @param {Array} [options.mutation] Sets allowed [mutation methods](mutation) for evolution, a random mutation method will be chosen from the array when mutation occurs. Optional, but default methods are non-recurrent.
   * @param {number} [options.maxNodes=Infinity] Maximum nodes for a potential network
   * @param {number} [options.maxConns=Infinity] Maximum connections for a potential network
   * @param {number} [options.maxGates=Infinity] Maximum gates for a potential network
   * @param {function} [options.mutationSelection=random] Custom mutation selection function if given
   * @param {boolean} [options.efficientMutation=false] Test & reduce [mutation methods](mutation) to avoid failed mutation attempts
   *
   * @returns {{error:{number},iterations:{number},time:{number}}} A summary object of the network's performance
   *
   * @example
   * let { Network, methods } = require("@liquid-carrot/carrot");
   *
   * async function execute () {
   *    var network = new Network(2,1);
   *
   *    // XOR dataset
   *    var trainingSet = [
   *        { input: [0,0], output: [0] },
   *        { input: [0,1], output: [1] },
   *        { input: [1,0], output: [1] },
   *        { input: [1,1], output: [0] }
   *    ];
   *
   *    await network.evolve(trainingSet, {
   *        mutation: methods.mutation.FFW,
   *        equal: true,
   *        error: 0.05,
   *        elitism: 5,
   *        mutationRate: 0.5
   *    });
   *
   *    network.activate([0,0]); // 0.2413
   *    network.activate([0,1]); // 1.0000
   *    network.activate([1,0]); // 0.7663
   *    network.activate([1,1]); // -0.008
   * }
   *
   * execute();
   */
  evolve: async function(set, options) {
    if(set[0].input.length !== this.input_size || set[0].output.length !== this.output_size) {
      throw new Error(`Dataset input/output size should be same as network input/output size!`);
    }

    // Read the options
    options = options || {};

    let target_error;

    if (typeof options.iterations === `undefined` && typeof options.error === `undefined`) {
      options.iterations = 1000; // limit in case network is not converging
      target_error = 0.05
    } else if (options.iterations) {
      target_error = -1; // run until iterations
    } else if (options.error) {
      target_error = options.error
      options.iterations = 0; // run until target error
    }

    var growth = typeof options.growth !== `undefined` ? options.growth : 0.0001;
    var cost = options.cost || methods.cost.MSE;
    var amount = options.amount || 1;
    let defaultSet = set;

    var threads = options.threads;
    if (typeof threads === `undefined`) {
      if (typeof window === `undefined`) { // Node.js
        threads = require(`os`).cpus().length;
      } else { // Browser
        threads = navigator.hardwareConcurrency;
      }
    }

    var start = Date.now();

    if (threads === 1) {
      // Create the fitness function
      options.fitness = function (set = defaultSet, genome, amount = 1, cost = methods.cost.MSE, growth = 0.0001) {
        var score = 0;
        for (var i = 0; i < amount; i++) score -= genome.test(set, cost).error;

        score -= (genome.nodes.length - genome.input - genome.output + genome.connections.length + genome.gates.length) * growth;
        score = isNaN(score) ? -Infinity : score; // this can cause problems with fitness proportionate selection

        return score / amount;
      };
    } else {
      // Serialize the dataset
      var converted = multi.serializeDataSet(set);

      // Create workers, send datasets
      var workers = [];
      if (typeof window === `undefined`) {
        for (var i = 0; i < threads; i++) workers.push(new multi.workers.node.TestWorker(converted, cost));
      } else {
        for (var i = 0; i < threads; i++) workers.push(new multi.workers.browser.TestWorker(converted, cost));
      }

      options.fitness = function (set, population) {
        return new Promise((resolve, reject) => {
          // Create a queue
          var queue = population.slice();
          var done = 0;

          // Start worker function
          var startWorker = function (worker) {
            if (!queue.length) {
              if (++done === threads) resolve();
              return;
            }

            var genome = queue.shift();

            worker.evaluate(genome).then(function (result) {
              genome.score = -result;
              genome.score -= (genome.nodes.length - genome.input - genome.output +
                genome.connections.length + genome.gates.length) * growth;
              genome.score = isNaN(parseFloat(result)) ? -Infinity : genome.score;
              startWorker(worker);
            });
          };

          for (var i = 0; i < workers.length; i++) startWorker(workers[i]);
        });
      };

      options.fitnessPopulation = true;
    }

    // Intialise the NEAT instance
    options.network = this;
    options.input = this.input_size;
    options.output = this.output_size;
    var neat = new Neat(set, options);

    var error = -Infinity;
    var bestFitness = -Infinity;
    var bestGenome;

    while (error < -target_error && (options.iterations === 0 || neat.generation < options.iterations)) {
      let fittest = await neat.evolve();
      let fitness = fittest.score;
      error = fitness + (fittest.nodes.length - fittest.input - fittest.output + fittest.connections.length + fittest.gates.length) * growth;

      if (fitness > bestFitness) {
        bestFitness = fitness;
        bestGenome = fittest;
      }

      if (options.log && neat.generation % options.log === 0) {
        console.log(`iteration`, neat.generation, `fitness`, fitness, `error`, -error);
      }

      if (options.schedule && neat.generation % options.schedule.iterations === 0) {
        options.schedule.function({ fitness: fitness, error: -error, iteration: neat.generation });
      }
    }

    if(threads > 1) {
      for (var i = 0; i < workers.length; i++) workers[i].terminate();
    }

    if(typeof bestGenome !== `undefined`) {
      this.nodes = bestGenome.nodes;
      this.connections = bestGenome.connections;
      this.selfconns = bestGenome.selfconns;
      this.gates = bestGenome.gates;

      if(options.clear) this.clear();
    }

    return {
      error: -error,
      iterations: neat.generation,
      time: Date.now() - start
    };
  },

  /**
   * Creates a standalone function of the network which can be run without the need of a library
   *
   * @returns {string} Function as a string that can be eval'ed
   *
   * @example
   * let { Network, architect } = require("@liquid-carrot/carrot");
   *
   * var myNetwork = new architect.Perceptron(2,4,1);
   * myNetwork.activate([0,1]); // [0.24775789809]
   *
   * // a string
   * var standalone = myNetwork.standalone();
   *
   * // turns your network into an 'activate' function
   * eval(standalone);
   *
   * // calls the standalone function
   * activate([0,1]);// [0.24775789809]
   */
  standalone: function standalone() {
    const present = [];
    const activations = [];
    const states = [];
    const lines = [];
    const functions = [];

    // get input nodes
    for (let i = 0; i < this.input_size; i++) {
      var node = this.nodes[i];
      activations.push(node.activation);
      states.push(node.state);
    }

    lines.push(`for(var i = 0; i < input.length; i++) A[i] = input[i];`);

    // So we don't have to use expensive .indexOf()
    for (i = 0; i < this.nodes.length; i++) {
      this.nodes[i].index = i;
    }

    for (i = this.input_size; i < this.nodes.length; i++) {
      let node = this.nodes[i];
      activations.push(node.activation);
      states.push(node.state);

      const function_index = present.indexOf(node.squash.name);

      if (function_index === -1) {
        function_index = present.length;
        present.push(node.squash.name);
        functions.push(node.squash.toString());
      }

      const incoming = [];
      for (var j = 0; j < node.connections.in.length; j++) {
        const connection = node.connections.in[j];
        let computation = `A[${connection.from.index}] * ${connection.weight}`;

        if (connection.gater != null) {
          computation += ` * A[${connection.gater.index}]`;
        }

        incoming.push(computation);
      }

      if (node.connections.self.weight) {
        const connection = node.connections.self;
        let computation = `S[${i}] * ${connection.weight}`;

        if (connection.gater != null) {
          computation += ` * A[${connection.gater.index}]`;
        }

        incoming.push(computation);
      }

      // the number indicates the order of execution
      const line1 = `S[${i}] = ${incoming.join(` + `)} + ${node.bias};`;
      const line2 = `A[${i}] = F[${function_index}](S[${i}])${!node.mask ? ` * ` + node.mask : ``};`;
      lines.push(line1);
      lines.push(line2);
    }

    let output = [];
    for (i = this.nodes.length - this.output_size; i < this.nodes.length; i++) {
      output.push(`A[${i}]`);
    }

    output = `return [${output.join(`,`)}];`;
    lines.push(output);

    let total = ``;
    total += `var F = [${functions.toString()}];\r\n`;
    total += `var A = [${activations.toString()}];\r\n`;
    total += `var S = [${states.toString()}];\r\n`;
    total += `function activate(input){\r\n${lines.join(`\r\n`)}\r\n}`;

    return total;
  },

  /**
   * Serialize to send to workers efficiently
   *
   * @returns {Array<number[]>} 3 `Float64Arrays`. Used for transferring networks to other threads fast.
   */
  serialize: function serialize() {
    const activations = [];
    const states = [];
    const connections = [];
    const squashes = [
      `LOGISTIC`, `TANH`, `IDENTITY`, `STEP`, `RELU`, `SOFTSIGN`, `SINUSOID`,
      `GAUSSIAN`, `BENT_IDENTITY`, `BIPOLAR`, `BIPOLAR_SIGMOID`, `HARD_TANH`,
      `ABSOLUTE`, `INVERSE`, `SELU`
    ];

    connections.push(this.input_size);
    connections.push(this.output_size);

    let node_index_counter = 0;
    _.forEach(this.nodes, (node) => {
      node.index = node_index_counter;
      node_index_counter++;
      activations.push(node.activation);
      states.push(node.state);
    });

    for (let node_index = this.input_size; node_index < this.nodes.length; node_index++) {
      const node = this.nodes[node_index];
      connections.push(node.index);
      connections.push(node.bias);
      connections.push(squashes.indexOf(node.squash.name));

      connections.push(node.connections.self.weight);
      connections.push(node.connections.self.gater == null ? -1 : node.connections.self.gater.index);

      _.times(node.connections.in.length, (incoming_connections_index) => {
        const connection = node.connectionections.in[incoming_connectionections_index];

        connectionections.push(connection.from.index);
        connectionections.push(connection.weight);
        connectionections.push(connection.gater == null ? -1 : connection.gater.index);
      });

      connections.push(-2); // stop token -> next node
    }

    return [activations, states, connections];
  }
};

/**
 * Convert a json object to a network
 *
 * @param {{input:{number},output:{number},dropout:{number},nodes:Array<object>,connections:Array<object>}} json A network represented as a json object
 *
 * @returns {Network} Network A reconstructed network
 *
 * @example
 * let { Network } = require("@liquid-carrot/carrot");
 *
 * let exported = myNetwork.to_JSON();
 * let imported = Network.from_JSON(exported) // imported will be a new instance of Network that is an exact clone of myNetwork
 */
Network.from_JSON = function(json) {
  var network = new Network(json.input, json.output);
  network.dropout = json.dropout;
  network.nodes = [];
  network.connections = [];

  _.forEach(json.nodes, (node) => network.nodes.push(Node.from_JSON(node)));

  _.forEach(json.connections, (json_connection) => {
    var connection =
      network.connect(network.nodes[json_connection.from], network.nodes[json_connection.to])[0];
    connection.weight = json_connection.weight;

    if (json_connection.gater != null) {
      network.gate(network.nodes[json_connection.gater], connection);
    }
  });

  return network;
};

/**
 * For backward compatibility
 */
Network.fromJSON = Network.from_JSON;

/**
 * Merge two networks into one.
 *
 * The merge functions takes two networks, the output size of `network1` should be the same size as the input of `network2`. Merging will always be one to one to conserve the purpose of the networks.
 *
 * @param {Network} network1 Network to merge
 * @param {Network} network2 Network to merge
 * @returns {Network} Network Merged Network
 *
 * @example
 * let { Network, architect } = require("@liquid-carrot/carrot");
 *
 * let XOR = architect.Perceptron(2,4,1); // assume this is a trained XOR
 * let NOT = architect.Perceptron(1,2,1); // assume this is a trained NOT
 *
 * // combining these will create an XNOR
 * let XNOR = Network.merge(XOR, NOT);
 */
Network.merge = function(network1, network2) {
  // Create a copy of the networks
  network1 = Network.from_JSON(network1.to_JSON());
  network2 = Network.from_JSON(network2.to_JSON());

  // Check if output and input size are the same
  if (network1.output !== network2.input) {
    throw new Error(`Output size of network1 should be the same as the input size of network2!`);
  }

  // Redirect all connections from network2 input from network1 output
  var i;
  for (i = 0; i < network2.connections.length; i++) {
    let conn = network2.connections[i];
    if (conn.from.type === `input`) {
      let index = network2.nodes.indexOf(conn.from);

      // redirect
      conn.from = network1.nodes[network1.nodes.length - 1 - index];
    }
  }

  // Delete input nodes of network2
  for (i = network2.input - 1; i >= 0; i--) {
    network2.nodes.splice(i, 1);
  }

  // Change the node type of network1's output nodes (now hidden)
  for (i = network1.nodes.length - network1.output; i < network1.nodes.length; i++) {
    network1.nodes[i].type = `hidden`;
  }

  // Create one network from both networks
  network1.connections = network1.connections.concat(network2.connections);
  network1.nodes = network1.nodes.concat(network2.nodes);

  return network1;
};

/**
 * Create an offspring from two parent networks.
 *
 * Networks are not required to have the same size, however input and output size should be the same!
 *
 * @todo Add custom [crossover](crossover) method customization
 *
 * @param {Network} network1 First parent network
 * @param {Network} network2 Second parent network
 * @param {boolean} [equal] Flag to indicate equally fit Networks
 *
 * @returns {Network} New network created from mixing parent networks
 *
 * @example
 * let { Network, architect } = require("@liquid-carrot/carrot");
 *
 * // Initialise two parent networks
 * let network1 = new architect.Perceptron(2, 4, 3);
 * let network2 = new architect.Perceptron(2, 4, 5, 3);
 *
 * // Produce an offspring
 * let network3 = Network.cross_over(network1, network2);
 */
Network.cross_over = function(network1, network2, equal) {
  if (network1.input !== network2.input || network1.output !== network2.output) {
    throw new Error("Networks don`t have the same input/output size!");
  }

  // Initialise offspring
  var offspring = new Network(network1.input, network1.output);
  offspring.connections = [];
  offspring.nodes = [];

  // Save scores and create a copy
  var score1 = network1.score || 0;
  var score2 = network2.score || 0;

  // Determine offspring node size
  var size;
  if(equal || score1 === score2) {
    let max = Math.max(network1.nodes.length, network2.nodes.length);
    let min = Math.min(network1.nodes.length, network2.nodes.length);
    size = Math.floor(Math.random() * (max - min + 1) + min);
  } else if(score1 > score2) {
    size = network1.nodes.length;
  } else {
    size = network2.nodes.length;
  }

  // Rename some variables for easier reading
  var outputSize = network1.output;

  // Set indexes so we don't need indexOf
  var i;
  for (i = 0; i < network1.nodes.length; i++) {
    network1.nodes[i].index = i;
  }

  for (i = 0; i < network2.nodes.length; i++) {
    network2.nodes[i].index = i;
  }

  // Assign nodes from parents to offspring
  for (i = 0; i < size; i++) {
    // Determine if an output node is needed
    var node;
    if (i < size - outputSize) {
      let random = Math.random();
      node = random >= 0.5 ? network1.nodes[i] : network2.nodes[i];
      let other = random < 0.5 ? network1.nodes[i] : network2.nodes[i];

      if (typeof node === `undefined` || node.type === `output`) {
        node = other;
      }
    } else {
      if (Math.random() >= 0.5) {
        node = network1.nodes[network1.nodes.length + i - size];
      } else {
        node = network2.nodes[network2.nodes.length + i - size];
      }
    }

    var newNode = new Node();
    newNode.bias = node.bias;
    newNode.squash = node.squash;
    newNode.type = node.type;

    offspring.nodes.push(newNode);
  }

  // Create arrays of connection genes
  var n1conns = {};
  var n2conns = {};

  // Normal connections
  for (i = 0; i < network1.connections.length; i++) {
    let conn = network1.connections[i];
    let data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1
    };
    n1conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Selfconnections
  for (i = 0; i < network1.selfconns.length; i++) {
    let conn = network1.selfconns[i];
    let data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1
    };
    n1conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Normal connections
  for (i = 0; i < network2.connections.length; i++) {
    let conn = network2.connections[i];
    let data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1
    };
    n2conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Selfconnections
  for (i = 0; i < network2.selfconns.length; i++) {
    let conn = network2.selfconns[i];
    let data = {
      weight: conn.weight,
      from: conn.from.index,
      to: conn.to.index,
      gater: conn.gater != null ? conn.gater.index : -1
    };
    n2conns[Connection.innovationID(data.from, data.to)] = data;
  }

  // Split common conn genes from disjoint or excess conn genes
  var connections = [];
  var keys1 = Object.keys(n1conns);
  var keys2 = Object.keys(n2conns);
  for (i = keys1.length - 1; i >= 0; i--) {
    // Common gene
    if (typeof n2conns[keys1[i]] !== `undefined`) {
      let conn = Math.random() >= 0.5 ? n1conns[keys1[i]] : n2conns[keys1[i]];
      connections.push(conn);

      // Because deleting is expensive, just set it to some value
      n2conns[keys1[i]] = undefined;
    } else if (score1 >= score2 || equal) {
      connections.push(n1conns[keys1[i]]);
    }
  }

  // Excess/disjoint gene
  if (score2 >= score1 || equal) {
    for (i = 0; i < keys2.length; i++) {
      if (typeof n2conns[keys2[i]] !== `undefined`) {
        connections.push(n2conns[keys2[i]]);
      }
    }
  }

  // Add common conn genes uniformly
  for (i = 0; i < connections.length; i++) {
    let connData = connections[i];
    if (connData.to < size && connData.from < size) {
      let from = offspring.nodes[connData.from];
      let to = offspring.nodes[connData.to];
      let conn = offspring.connect(from, to)[0];

      conn.weight = connData.weight;

      if (connData.gater !== -1 && connData.gater < size) {
        offspring.gate(offspring.nodes[connData.gater], conn);
      }
    }
  }

  return offspring;
};

module.exports = Network;

/**
* Runs the NEAT algorithm on group of neural networks.
*
* @constructs Neat
*
* @private
*
* @param {Array<{input:number[],output:number[]}>} [dataset] A set of input values and ideal output values to evaluate a genome's fitness with. Must be included to use `NEAT.evaluate` without passing a dataset
* @param {Object} options - Configuration options
* @param {number} input - The input size of `template` networks.
* @param {number} output - The output size of `template` networks.
* @param {boolean} [options.equal=false] When true [crossover](Network.cross_over) parent genomes are assumed to be equally fit and offspring are built with a random amount of neurons within the range of parents' number of neurons. Set to false to select the "fittest" parent as the neuron amount template.
* @param {number} [options.clear=false] Clear the context of the population's nodes, basically reverting them to 'new' neurons. Useful for predicting timeseries with LSTM's.
* @param {number} [options.popsize=50] Population size of each generation.
* @param {number} [options.growth=0.0001] Set the penalty for large networks. Penalty calculation: penalty = (genome.nodes.length + genome.connectoins.length + genome.gates.length) * growth; This penalty will get added on top of the error. Your growth should be a very small number.
* @param {cost} [options.cost=cost.MSE]  Specify the cost function for the evolution, this tells a genome in the population how well it's performing. Default: methods.cost.MSE (recommended).
* @param {number} [options.amount=1] Set the amount of times to test the trainingset on a genome each generation. Useful for timeseries. Do not use for regular feedfoward problems.
* @param {number} [options.elitism=1] Elitism of every evolution loop. [Elitism in genetic algortihtms.](https://www.researchgate.net/post/What_is_meant_by_the_term_Elitism_in_the_Genetic_Algorithm)
* @param {number} [options.provenance=0] Number of genomes inserted the original network template (Network(input,output)) per evolution.
* @param {number} [options.mutationRate=0.4] Sets the mutation rate. If set to 0.3, 30% of the new population will be mutated. Default is 0.4.
* @param {number} [options.mutationAmount=1] If mutation occurs (randomNumber < mutationRate), sets amount of times a mutation method will be applied to the network.
* @param {boolean} [options.fitnessPopulation=false] Flag to return the fitness of a population of genomes. Set this to false to evaluate each genome inidividually.
* @param {Function} [options.fitness] - A fitness function to evaluate the networks. Takes a `dataset` and a `genome` i.e. a [network](Network) or a `population` i.e. an array of networks and sets the genome `.score` property
* @param {string} [options.selection=FITNESS_PROPORTIONATE] [Selection method](selection) for evolution (e.g. Selection.FITNESS_PROPORTIONATE).
* @param {Array} [options.crossover] Sets allowed crossover methods for evolution.
* @param {Network} [options.network=false] Network to start evolution from
* @param {number} [options.maxNodes=Infinity] Maximum nodes for a potential network
* @param {number} [options.maxConns=Infinity] Maximum connections for a potential network
* @param {number} [options.maxGates=Infinity] Maximum gates for a potential network
* @param {function} [options.mutationSelection=ALL] Custom mutation selection function if given
* @param {mutation[]} [options.mutation] Sets allowed [mutation methods](mutation) for evolution, a random mutation method will be chosen from the array when mutation occurs. Optional, but default methods are non-recurrent
*
* @prop {number} generation A count of the generations
* @prop {Network[]} population The current population for the neat instance. Accessible through `neat.population`
*
* @example
* let { Neat } = require("@liquid-carrot/carrot");
*
* let neat = new Neat(4, 1, dataset, {
*   elitism: 10,
*   clear: true,
*   popsize: 1000
* });
*/
const Neat = function(dataset, {
  generation = 0, // internal variable
  input = 1,
  output = 1,
  equal = true,
  clean = false,
  popsize = 50,
  growth = 0.0001,
  cost = methods.cost.MSE,
  amount = 1,
  elitism = 1,
  provenance = 0,
  mutationRate = 0.4,
  mutationAmount = 1,
  fitnessPopulation = false,
  fitness = function(set = dataset, genome, amount = 1, cost = methods.cost.MSE, growth = 0.0001) {
    let score = 0;
    for (let i = 0; i < amount; i++) score -= genome.test(set, cost).error;

    score -= (genome.nodes.length - genome.input - genome.output + genome.connections.length + genome.gates.length) * growth;
    score = isNaN(score) ? -Infinity : score; // this can cause problems with fitness proportionate selection

    return score / amount;
  },
  selection = methods.selection.POWER,
  crossover = [
    methods.crossover.SINGLE_POINT,
    methods.crossover.TWO_POINT,
    methods.crossover.UNIFORM,
    methods.crossover.AVERAGE
  ],
  mutation = methods.mutation.FFW,
  efficientMutation = false,
  template = (new Network(input, output)),
  maxNodes = Infinity,
  maxConns = Infinity,
  maxGates = Infinity,
  selectMutationMethod = this.selectMutationMethod
} = {}) {
  let self = this;

  _.assignIn(self, {
    generation,
    input,
    output,
    equal,
    clean,
    popsize,
    growth,
    cost,
    amount,
    elitism,
    provenance,
    mutationRate,
    mutationAmount,
    fitnessPopulation,
    fitness,
    selection,
    crossover,
    mutation,
    efficientMutation,
    template,
    maxNodes,
    maxConns,
    maxGates,
    selectMutationMethod
  });

  /**
   * Create the initial pool of genomes
   *
   * @param {Network} network
   */
  self.createPool = function createInitialPopulation (network, popsize) {
    return Array(popsize).fill(Network.from_JSON({ ...network.to_JSON(), score: undefined }))
  };

  // Initialise the genomes
  self.population = self.createPool(self.template, self.popsize);

  self.filterGenome = function(population, template, pickGenome, adjustGenome) {
      let filtered = [...population]; // avoid mutations

      // Check for correct return type from pickGenome
      const check = function checkPick(genome) {
        const pick = pickGenome(genome)
        if (typeof pick !== "boolean") throw new Error("pickGenome must always return a boolean!")
        return pick
      }

      if(adjustGenome){
        for (let i = 0; i < population.length; i++) {
          if(check(filtered[i])) {
            const result = adjustGenome(filtered[i])
            if (!(result instanceof Network)) throw new Error("adjustGenome must always return a network!")
            filtered[i] = result
          }
        }
      } else
          for (let i = 0; i < population.length; i++)
            if(check(filtered[i])) filtered[i] = Network.from_JSON(template.to_JSON)

      return filtered;
    };

  /**
   * Selects a random mutation method for a genome according to the parameters
   *
   * @param {Network} genome Network to test for possible mutations
   * @param {mutation[]} allowedMutations An array of allowed mutations to pick from
   * @param {boolean} efficientMutation A flag to enable checking for possible mutations on a [network](Network)
   *
   * @return {mutation} Selected mutation
  */
  self.selectMutationMethod = function (genome, allowedMutations, efficientMutation) {
    efficientMutation = false;
    if(efficientMutation) {
      let filtered = allowedMutations ? [...allowedMutations] : [...self.mutation]
      let success = false
      while(!success) {
        const currentMethod = filtered[Math.floor(Math.random() * filtered.length)]

        if(currentMethod === methods.mutation.ADD_NODE && genome.nodes.length >= self.maxNodes || currentMethod === methods.mutation.ADD_CONN && genome.connections.length >= self.maxConns || currentMethod === methods.mutation.ADD_GATE && genome.gates.length >= self.maxGates) {
          success = false
        } else {
          success = genome.mutate(currentMethod) // actual mutation happens
        }

        // we're done
        if(success || !filtered || filtered.length === 0) return

        // if not, remove the impossible method
        filtered = filtered.filter(function(value, index, array) {
          return value.name !== currentMethod.name
        })
      }
    } else {
      let allowed = allowedMutations ? allowedMutations : self.mutation
      let current = allowed[Math.floor(Math.random() * allowed.length)]

      if (current === methods.mutation.ADD_NODE && genome.nodes.length >= self.maxNodes) {
        if (config.warnings) console.warn(`maxNodes exceeded!`)
        return null;
      }

      if (current === methods.mutation.ADD_CONN && genome.connections.length >= self.maxConns) {
        if (config.warnings) console.warn(`maxConns exceeded!`);
        return null;
      }

      if (current === methods.mutation.ADD_GATE && genome.gates.length >= self.maxGates) {
        if (config.warnings) console.warn(`maxGates exceeded!`);
        return null;
      }

      return current
    }
  };

  /**
   * Evaluates, selects, breeds and mutates population
   *
   * @param {Array<{input:number[],output:number[]}>} [evolveSet=dataset] A set to be used for evolving the population, if none is provided the dataset passed to Neat on creation will be used.
   * @param {function} [pickGenome] A custom selection function to pick out unwanted genomes. Accepts a network as a parameter and returns true for selection.
   * @param {function} [adjustGenome=this.template] Accepts a network, modifies it, and returns it. Used to modify unwanted genomes returned by `pickGenome` and reincorporate them into the population. If left unset, unwanted genomes will be replaced with the template Network. Will only run when pickGenome is defined.
   *
   * @returns {Network} Fittest network
   *
   * @example
   * let neat = new Neat(dataset, {
   *  elitism: 10,
   *  clear: true,
   *  popsize: 1000
   * });
   *
   * let filter = function(genome) {
   *  // Remove genomes with more than 100 nodes
   *  return genome.nodes.length > 100 ? true : false
   * }
   *
   * let adjust = function(genome) {
   *  // clear the nodes
   *  return genome.clear()
   * }
   *
   * neat.evolve(evolveSet, filter, adjust).then(function(fittest) {
   *  console.log(fittest)
   * })
  */
  self.evolve = async function (evolveSet, pickGenome, adjustGenome) {
    // Check if evolve is possible
    if(self.elitism + self.provenance > self.popsize) throw new Error("Can`t evolve! Elitism + provenance exceeds population size!");

    // Check population for evaluation
    if (typeof self.population[self.population.length - 1].score === `undefined`)
      await self.evaluate(_.isArray(evolveSet) ? evolveSet : _.isArray(dataset) ? dataset : parameter.is.required("dataset"));
    // Check & adjust genomes as needed
    if(pickGenome) self.population = self.filterGenome(self.population, self.template, pickGenome, adjustGenome)

    // Sort in order of fitness (fittest first)
    self.sort();

    // Elitism, assumes population is sorted by fitness
    var elitists = [];
    for (let i = 0; i < self.elitism; i++) elitists.push(self.population[i]);

    // Provenance
    let newPopulation = Array(self.provenance).fill(Network.from_JSON(self.template.to_JSON()))

    // Breed the next individuals
    for (let i = 0; i < self.popsize - self.elitism - self.provenance; i++)
      newPopulation.push(self.getOffspring());

    // Replace the old population with the new population
    self.population = newPopulation;

    // Mutate the new population
    self.mutate();

    // Add the elitists
    self.population.push(...elitists);

    // evaluate the population
    await self.evaluate(_.isArray(evolveSet) ? evolveSet : _.isArray(dataset) ? dataset : parameter.is.required("dataset"));

    // Check & adjust genomes as needed
    if(pickGenome) self.population = self.filterGenome(self.population, self.template, pickGenome, adjustGenome)

    // Sort in order of fitness (fittest first)
    self.sort()

    const fittest = Network.from_JSON(self.population[0].to_JSON());
    fittest.score = self.population[0].score;

    // Reset the scores
    for (let i = 0; i < self.population.length; i++) self.population[i].score = undefined;

    self.generation++;

    return fittest;
  };

  /**
   * Returns a genome for recombination (crossover) based on one of the [selection methods](selection) provided.
   *
   * Should be called after `evaluate()`
   *
   * @return {Network} Selected genome for offspring generation
   */
  self.getParent = function () {
    switch (self.selection.name) {
      case `POWER`: {
        if (self.population[0].score < self.population[1].score) self.sort();

        var index = Math.floor(Math.pow(Math.random(), self.selection.power) * self.population.length);
        return self.population[index];
      }
      case `FITNESS_PROPORTIONATE`: {
        // As negative fitnesses are possible
        // https://stackoverflow.com/questions/16186686/genetic-algorithm-handling-negative-fitness-values
        // this is unnecessarily run for every individual, should be changed

        var totalFitness = 0;
        var minimalFitness = 0;
        for (let i = 0; i < self.population.length; i++) {
          var score = self.population[i].score;
          minimalFitness = score < minimalFitness ? score : minimalFitness;
          totalFitness += score;
        }

        minimalFitness = Math.abs(minimalFitness);
        totalFitness += minimalFitness * self.population.length;

        var random = Math.random() * totalFitness;
        var value = 0;

        for (let i = 0; i < self.population.length; i++) {
          let genome = self.population[i];
          value += genome.score + minimalFitness;
          if (random < value) return genome;
        }

        // if all scores equal, return random genome
        return self.population[Math.floor(Math.random() * self.population.length)];
      }
      case `TOURNAMENT`: {
        if (self.selection.size > self.popsize) {
          throw new Error(`Your tournament size should be lower than the population size, please change methods.selection.TOURNAMENT.size`);
        }

        // Create a tournament
        var individuals = [];
        for (let i = 0; i < self.selection.size; i++) {
          let random = self.population[Math.floor(Math.random() * self.population.length)];
          individuals.push(random);
        }

        // Sort the tournament individuals by score
        individuals.sort(function (a, b) {
          return b.score - a.score;
        });

        // Select an individual
        for (let i = 0; i < self.selection.size; i++)
          if (Math.random() < self.selection.probability || i === self.selection.size - 1) return individuals[i];
      }
    }
  };

  /**
   * Selects two genomes from the population with `getParent()`, and returns the offspring from those parents. NOTE: Population MUST be sorted
   *
   * @returns {Network} Child network
   */
  self.getOffspring = function () {
    var parent1 = self.getParent();
    var parent2 = self.getParent();

    return Network.cross_over(parent1, parent2, self.equal);
  };

  /**
   * Mutates the given (or current) population
   */
  self.mutate = function () {
    // Elitist genomes should not be included
    for (let i = 0; i < self.population.length; i++) {
      if (Math.random() <= self.mutationRate) {
        for (let j = 0; j < self.mutationAmount; j++) {
          const mutationMethod = self.selectMutationMethod(self.population[i], self.mutation, self.efficientMutation);
          self.efficientMutation ? null : self.population[i].mutate(mutationMethod);
        }
      }
    }
  };

  /**
   * Evaluates the current population, basically sets their `.score` property
   *
   * @return {Network} Fittest Network
   */
  self.evaluate = async function (dataset) {
    if (self.fitnessPopulation) {
      if (self.clear) {
        for (let i = 0; i < self.population.length; i++)
          self.population[i].clear();
      }
      await self.fitness(dataset, self.population);
    } else {
      for (let i = 0; i < self.population.length; i++) {
        const genome = self.population[i];
        if (self.clear) genome.clear();
        genome.score = await self.fitness(dataset, genome);
        self.population[i] = genome;
      }
    }

    // Sort the population in order of fitness
    self.sort()

    return self.population[0]
  };

  /**
   * Sorts the population by score
  */
  self.sort = function () {
    self.population.sort(function (a, b) {
      return b.score - a.score;
    });
  };

  /**
   * Returns the fittest genome of the current population
   *
   * @returns {Network} Current population's fittest genome
  */
  self.getFittest = function () {
    // Check if evaluated. self.evaluate is an async function
    if (typeof self.population[self.population.length - 1].score === `undefined`)
      self.evaluate();

    if (self.population[0].score < self.population[1].score) self.sort();

    return self.population[0];
  };

  /**
   * Returns the average fitness of the current population
   *
   * @returns {number} Average fitness of the current population
   */
  self.getAverage = function () {
    if (typeof self.population[self.population.length - 1].score === `undefined`)
      self.evaluate(); // self.evaluate is an async function

    var score = 0;
    for (let i = 0; i < self.population.length; i++)
      score += self.population[i].score;

    return score / self.population.length;
  };

  /**
   * Export the current population to a JSON object
   *
   * Can be used later with `from_JSON(json)` to reload the population
   *
   * @return {object[]} A set of genomes (a population) represented as JSON objects.
   */
  self.to_JSON = function exportPopulation() {
    var json = [];
    for (let i = 0; i < self.population.length; i++)
      json.push(self.population[i].to_JSON());

    return json;
  };

  /**
   * Imports population from a json. Must be an array of networks converted to JSON objects.
   *
   * @param {object[]} json set of genomes (a population) represented as JSON objects.
  */
  self.from_JSON = function importPopulation(json) {
    var population = [];
    for (let i = 0; i < json.length; i++)
      population.push(Network.from_JSON(json[i]));
    self.population = population;
    self.popsize = population.length;
  };
}
